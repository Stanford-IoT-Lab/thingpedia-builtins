// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const crypto = require('crypto');
const fs = require('fs');
const Url = require('url');
const Tp = require('thingpedia');
const Omlib = require('omlib');

const OmletMessaging = require('./omlet_messaging');
const InMessageChannel = require('./inmessage');

const API_KEY = '00109b1ea59d9f46d571834870f0168b5ed20005871d8752ff';
const API_SECRET = 'bccb852856c462e748193d6211c730199d62adcf0ba963416fcc715a2db4d76f';

const IncomingMessageChannel = new Tp.ChannelClass({
    Name: 'IncomingMessageChannel',
    Extends: InMessageChannel,
    signal: 'incoming-message',
});

const NewMessageChannel = new Tp.ChannelClass({
    Name: 'NewMessageChannel',
    Extends: InMessageChannel,
    signal: 'new-message',
});

class DeviceStateStorage {
    constructor(device, backingObject) {
        this._device = device;
        this._storage = backingObject || {};
        this._stateChangedQueued = false;
    }

    _queueStateChanged() {
        if (this._stateChangedQueued)
            return;

        this._stateChangedQueued = true;
        setTimeout(() => {
            if (this._device !== null)
                this._device.stateChanged();
        }, 0);
    }

    serialize() {
        return this._storage;
    }

    setBackingStorage(storage) {
        this._storage = storage;
    }

    key(idx) {
        return Object.keys(this._storage)[idx];
    }
    getItem(key) {
        return this._storage[key];
    }
    setItem(key, value) {
        this._storage[key] = value;
        this._queueStateChanged();
    }
    removeItem(key) {
        delete this._storage[key];
        this._queueStateChanged();
    }
    clear() {
        this._storage = {};
        this._queueStateChanged();
    }
}

function safeMkdirSync(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

function makeOmletClient(instance, platform, storage) {
    var dbpath = platform.getWritableDir() + '/omlet';
    safeMkdirSync(dbpath);
    var client = new Omlib({ instance: instance,
                             storage: storage,
                             storagePath: dbpath,
                             sync: false,
                             apiKey: { Id: API_KEY, Secret: API_SECRET } });
    client._ldClient.longdanMessageConsumer.DEBUG = false;
    return client;
}

function findPrimaryIdentity(client) {
    if (!client._ldClient._details)
        return undefined;
    var account = client.auth.getAccount();
    var identities = client._ldClient._details.Identities;
    var omletId = null;
    var email = null;
    var phone = null;
    for (var i = 0; i < identities.length; i++) {
        var id = identities[i];
        if (id.Type === 'omlet')
            omletId = id.Principal;
        else if (id.Type === 'email' && email === null)
            email = id.Principal;
        else if (id.Type === 'phone' && phone === null)
            phone = id.Principal;
    }
    if (omletId !== null)
        return omletId;
    if (email !== null)
        return email;
    if (phone !== null)
        return phone;
    return account;
}

function runOAuth2Phase1(engine) {
    var buf = crypto.randomBytes(8).toString('hex');
    var storage = new DeviceStateStorage(null, undefined);
    var client = makeOmletClient(buf, engine.platform, storage);
    console.log('Obtained omlet Client');

    return Q.try(function() {
        client.connect();

        var origin = engine.platform.getOrigin();
        return Q.ninvoke(client._ldClient.auth, 'getAuthPage',
                         origin + '/devices/oauth2/callback/org.thingpedia.builtin.omlet',
                         ['PublicProfile', 'OmletChat']);
    }).then(function(resp) {
        console.log('Obtained omlet auth page response');

        var parsed = Url.parse(resp.Link, true);
        return [resp.Link, { 'omlet-query-key': parsed.query.k,
                             'omlet-instance': buf,
                             'omlet-storage': JSON.stringify(storage.serialize()) }];
    }).finally(function() {
        return client.disable();
    }).catch(function(e) {
        console.log(String(e));
        console.log(e.stack);
        throw e;
    });
}

function runOAuth2Phase2(engine, req) {
    var storageState = JSON.parse(req.session['omlet-storage']);
    var instance = req.session['omlet-instance'];
    var storage = new DeviceStateStorage(null, storageState);
    var client = makeOmletClient(instance, engine.platform, storage);
    console.log('Obtained omlet Client');

    var code = req.query.code;
    var key = req.session['omlet-query-key'];

    return Q.Promise(function(callback, errback) {
        client.connect();

        client._ldClient.onSignedUp = callback;
        client._ldClient.auth.confirmAuth(code, key);
    }).then(function() {
        return engine.devices.loadOneDevice({ kind: 'org.thingpedia.builtin.omlet',
                                              omletId: findPrimaryIdentity(client),
                                              instance: instance,
                                              storage: storage.serialize() }, true);
    }).finally(function() {
        client.disable();
    });
}

module.exports = new Tp.DeviceClass({
    Name: 'OmletDevice',
    UseOAuth2: function(engine, req) {
        if (req === null)
            return runOAuth2Phase1(engine);
        else
            return runOAuth2Phase2(engine, req);
    },

    _init: function(engine, state) {
        this.parent(engine, state);

        this._updateNameAndDescription();
        this.uniqueId = 'omlet-' + this.omletInstance;

        this._omletStorage = null;
        this._omletClient = null;
        this._omletClientCount = 0;
    },

    get ownerTier() {
        return Tp.Tier.GLOBAL;
    },

    _updateNameAndDescription: function() {
        this.name = "Omlet Account of %s".format(this.omletId);
        this.description = "This is your Omlet Account. You can use it to communicate and share data with your friends!";
    },

    updateState: function(newstate) {
        this.parent(newstate);
        if (this._omletStorage !== null)
            this._omletStorage.setBackingStorage(this.state.storage);
    },

    get omletInstance() {
        return this.state.instance;
    },

    get omletId() {
        return this.state.omletId;
    },

    get omletClient() {
        if (this._omletClient !== null)
            return this._omletClient;

        this._omletStorage = new DeviceStateStorage(this, this.state.storage);
        this._omletClient = makeOmletClient(this.omletInstance, this.engine.platform, this._omletStorage);
        return this._omletClient;
    },

    refOmletClient: function() {
        var client = this.omletClient;

        if (this._omletClientCount == 0) {
            client.connect();
            var identity = findPrimaryIdentity(client);
            if (identity !== undefined && identity !== this.state.omletId) {
                console.log('Omlet ID of ' + this.uniqueId + ' changed to ' + identity);
                this.state.omletId = identity;
                this._updateNameAndDescription();
                this.stateChanged();
            }
        }
        this._omletClientCount ++;
        return client;
    },

    unrefOmletClient: function() {
        setTimeout(() => {
            this._omletClientCount --;
            if (this._omletClientCount == 0) {
                this._omletClient = null;
                this.omletClient.disable();
            }
        }, 5000);
    },

    queryInterface: function(iface) {
        if (iface === 'omlet')
            return this.omletClient;
        else if (iface === 'messaging')
            return new OmletMessaging(this);
        else
            return null;
    },

    checkAvailable: function() {
        return Tp.Availability.AVAILABLE;
    },

    _doSend: function(event) {
        if (event.length < 3)
            throw new TypeError('Invalid arguments to @omlet.send(), expected feed, type, message');

        var feed = event[0];
        var msgType = event[1];
        var msg = event[2];

        if (msgType === 'text')
            feed.sendText(msg).done();
        else if (msgType === 'picture')
            feed.sendPicture(msg).done();
        else
            throw new TypeError('Invalid message type, expected text or picture');
    },

    getTriggerClass: function(name) {
        if (name === 'incomingmessage')
            return IncomingMessageChannel;
        else if (name === 'newmessage')
            return NewMessageChannel;
        else
            throw new Error('Invalid channel name ' + name);
    },

    invokeAction: function(name, args) {
        if (name === 'send')
            return this._doSend(args);
    }
});
