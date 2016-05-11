// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const Tp = require('thingpedia');
const Stream = require('stream');
const TripleStore = Tp.TripleStore;

const RDF_BASE = 'http://thingengine.stanford.edu/rdf/0.1/';
const ME = RDF_BASE + 'me';
const RDF_BASE_REGEX = '^http:\\/\\/thingengine\\.stanford\\.edu\\/rdf\\/0\\.1\\/';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const FOAF = 'http://xmlns.com/foaf/0.1/';
const FOAF_PERSON = FOAF + 'Person';
const FOAF_NAME = FOAF + 'name';
const FOAF_KNOWS = FOAF + 'knows';

function nonEmptyIntersection(s1, s2) {
    for (var o of s1)
        if (s2.has(o))
            return true;
    return false;
}

module.exports = class OmletTripleStore extends TripleStore {
    constructor(device) {
        super();

        this._device = device;
    }

    get uri() {
        return RDF_BASE + 'me/' + this._device.uniqueId;
    }

    ref() {
        this._client = this._device.refOmletClient();
    }

    unref() {
        this._device.unrefOmletClient();
    }

    get(patterns) {
        // the triples we have are of the form
        // ?s ?p ?o
        // tp:me foaf:knows ?uri
        // ?uri foaf:knows tp:me
        // tp:me foaf:knows tp:me
        // ?uri rdf:type foaf:Person
        // tp:me rdf:type foaf:Person
        // ?uri foaf:name "string"
        // tp:me foaf:name "string"
        //
        // this means that a variable can be
        // 1) a person (if in subject or object position)
        // 2) a predicate (rdf:type, foaf:name, foaf:knows)
        // 3) the exact value foaf:Person
        // 4) the exact value tp:me
        // 5) a person name (if in object position)
        //
        // we solve this as a constraint satisfaction problem,
        // in which we figure out first the predicate for a triple,
        // and then recursively assign each variable one of its
        // possible values
        //
        // note: this means we will ignore things like
        // tp:me rdf:type rdfs:Resource
        // or
        // rdf:type rdf:type rdfs:Property
        // this is ok under SPARQL simple entailment

        var stream = new Stream.Readable({ objectMode: true, read: function() {} });

        var invalidSubject = function(p) {
            return !p.subject.startsWith('?') && !p.subject.startsWith(RDF_BASE);
        };
        if (patterns.some(invalidSubject)) {
            stream.push(null);
            return stream;
        }

        var predicateVars = new Set();
        var otherVars = new Set();

        patterns.forEach((p) => {
            if (p.subject.startsWith('?'))
                otherVars.push(p.subject);
            if (p.predicate.startsWith('?'))
                predicateVars.push(p.predicate);
            if (p.object.startsWith('?'))
                otherVars.push(p.object);
        });


        // predicates can't be subject and viceversa
        if (nonEmptyIntersection(predicateVars, otherVars)) {
            stream.push(null);
            return stream;
        }

        var predicateToAssign = Array.from(predicateVars.values());
        var inflight = 0;
        function maybeEnd() {
            if (inflight === 0)
                stream.push(null);
        }
        function assignNextPredicate(i, scope) {
            if (i === predicateToAssign.length) {
                var otherToAssign;
                if (!(otherToAssign = sortOtherVariables())) {
                    return;
                }

                return assignNextType(0, otherToAssign, scopeCopy, aux);
            }

            var toAssign = predicateToAssign[i];
            for (var choice of [RDF_TYPE, FOAF_NAME, FOAF_KNOWS]) {
                // check if this choice is possible
                var impossible = function(pattern) {
                    if (pattern.predicate !== toAssign)
                        return false;
                    if (choice === RDF_TYPE &&
                        (!pattern.object.startsWith('?') && pattern.object !== FOAF_PERSON))
                        return true;
                    if (choice === FOAF_NAME &&
                        (!pattern.object.startsWith('?') && !pattern.object.startsWith('"')))
                        return true;
                    if (choice === FOAF_KNOWS &&
                        !pattern.subject.startsWith('?') && !pattern.object.startsWith('?') &&
                        pattern.subject !== ME && pattern.object !== ME)
                        return true;
                    return false;
                }
                if (patterns.some(impossible))
                    continue;

                scope[toAssign] = choice;
                assignNextPredicate(i+1, scope);
            }
            maybeEnd();
        }
        function sortOtherVariables() {
            var personVar = new Set();
            var typeVar = new Set();
            var nameVar = new Set();

            patterns.forEach(function(p) {
                var predicate;
                if (p.predicate.startsWith('?'))
                    predicate = predicateScope[p.predicate];
                else
                    predicate = p.predicate;

                if (p.subject.startsWith('?'))
                    personVar.push(p.subject);
                if (p.object.startsWith('?')) {
                    if (predicate === RDF_TYPE)
                        typeVar.push(p.object);
                    if (predicate === FOAF_NAME)
                        nameVar.push(p.object);
                    if (predicate === FOAF_KNOWS)
                        personVar.push(p.object);
                }
            });

            if (nonEmptyIntersection(personVar, typeVar) ||
                nonEmptyIntersection(personVar, nameVar) ||
                nonEmptyIntersection(typeVar, nameVar))
                return null;

            return [Array.from(typeVar.values()), Array.from(personVar.values()), Array.from(nameVar.values())];
        }
        function assignNextType(i, otherToAssign, scope, aux) {
            if (i === otherToAssign[0].length)
                return assignNextPerson(0, otherToAssign, scope, aux);

            var toAssign = otherToAssign[0][i];
            scope[toAssign] = FOAF_PERSON;
            return assignNextType(i+1, otherToAssign, scope, aux);
        }
                if (verify()) {
                    var solution = {};
                    Object.assign(solution, predicateScope);
                    Object.assign(solution, otherScope);
                    return stream.push(solution);
                }
            }

            var toAssign = predicateToAssign[i];
            // try as tp:me
            predicateScope

            // make a copy of scope
            var scopeCopy = {};
            Object.assign(scopeCopy, scope);
        }

        return stream;
    }
}
