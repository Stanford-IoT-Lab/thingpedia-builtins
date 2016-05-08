// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const Tp = require('thingpedia');

module.exports = new Tp.ChannelClass({
    Name: 'GpsChannel',
    RequiredCapabilities: ['gps'],

    _init: function(engine, device, params) {
        this.parent();

        this._gps = engine.platform.getCapability('gps');
    },

    _doOpen: function() {
        this._gps.onlocationchanged = this._onLocationChanged.bind(this);
        return this._gps.start();
    },

    _doClose: function() {
        this._gps.onlocationchanged = null;
        return this._gps.stop();
    },

    _onLocationChanged: function(error, location) {
        if (location === null)
            this.emitEvent(null);
        else
            this.emitEvent([{ x: location.longitude, y: location.latitude },
                            location.altitude,
                            location.bearing,
                            location.speed]);
    }
});
