// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'SabrinaPictureChannel',
    Extends: Tp.SimpleAction,

    _init: function(engine, device) {
        this.parent();
        this.engine = engine;
    },

    _doInvoke: function(url) {
        this.engine.assistant.sendPicture(url)
        .catch(function(e) {
            console.error('Failed to send picture from Sabrina');
            console.error(e.stack);
        });
    },
});
