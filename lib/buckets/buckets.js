/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

var assert = require('assert-plus');
var common = require('../common');
var errors = require('../errors');

function loadRequest(req, res, next) {

    if (req.params.object_name) {
        req.bucketObject = new BucketObject(req);
    }

    if (req.params.bucket_name) {
        req.bucket = new Bucket(req);
    }

    next();

}

/* This is a function used before bucket object operations */
function getBucketIfExists(req, res, next) {
    var owner = req.owner.account.uuid;
    var bucket = req.bucket;
    var requestId = req.getId();
    var log = req.log;

    log.debug({
        owner: owner,
        bucket: bucket.name,
        requestId: requestId
    }, 'getBucketIfExists: requested');

    var onGetBucket = function onGet(err, bucket_data) {
        if (err) {
            var notFoundErr;
            if (err.cause.name === 'BucketNotFoundError') {
                notFoundErr = new errors.BucketNotFoundError(bucket.name);
            } else {
                notFoundErr = err;
            }
            log.debug({
                err: notFoundErr,
                owner: owner,
                bucket: bucket.name,
                requestId: requestId
            }, 'getBucketIfExists: failed');
            next(notFoundErr);
            return;
        } else {
            log.debug({
                owner: owner,
                bucket: bucket.name,
                requestId: requestId
            }, 'getBucketIfExists: done');
            req.bucket.id = bucket_data.id;
            next(null, bucket_data);
        }
    };

    req.boray.getBucketNoVnode(owner, bucket.name, onGetBucket);
}

function Bucket(req) {

    var self = this;

    assert.object(req, 'req');
    if (req.params.bucket_name) {
        self.name = req.params.bucket_name;
    }
    self.type = 'bucket';

    return (self);

}

function BucketObject(req) {

    var self = this;

    assert.object(req, 'req');
    assert.string(req.params.bucket_name, 'req.params.bucket_name');
    self.bucket_name = req.params.bucket_name;
    if (req.params.object_name) {
        self.name = req.params.object_name;
    }
    self.type = 'bucketobject';

    return (self);

}


// TODO: Break this up into smaller pieces
function createObjectMetadata(req, type, cb) {
    var names;
    var md = {
        headers: {},
        roles: [],
        type: 'bucketobject'
    };

    common.CORS_RES_HDRS.forEach(function (k) {
        var h = req.header(k);
        if (h) {
            md.headers[k] = h;
        }
    });

    if (req.headers['cache-control'])
        md.headers['Cache-Control'] = req.headers['cache-control'];

    if (req.headers['surrogate-key'])
        md.headers['Surrogate-Key'] = req.headers['surrogate-key'];

    var hdrSize = 0;
    Object.keys(req.headers).forEach(function (k) {
        if (/^m-\w+/.test(k)) {
            hdrSize += Buffer.byteLength(req.headers[k]);
            if (hdrSize < common.MAX_HDRSIZE)
                md.headers[k] = req.headers[k];
        }
    });

    md.contentLength = req._size;
    md.contentMD5 = req._contentMD5;
    md.contentType = req.header('content-type') ||
        'application/octet-stream';
    md.objectId = req.objectId;

    if (md.contentLength === 0) { // Chunked requests
        md.sharks = [];
    } else if (req.sharks && req.sharks.length) { // Normal requests
        md.sharks = req.sharks.map(function (s) {
            return ({
                datacenter: s._shark.datacenter,
                manta_storage_id: s._shark.manta_storage_id
            });
        });
    } else { // Take from the prev is for things like mchattr
        md.sharks = [];
    }

    // mchattr
    var requestedRoleTags;
    if (req.auth && typeof (req.auth['role-tag']) === 'string') { // from URL
        requestedRoleTags = req.auth['role-tag'];
    } else {
        requestedRoleTags = req.headers['role-tag'];
    }

    if (requestedRoleTags) {
        /* JSSTYLED */
        names = requestedRoleTags.split(/\s*,\s*/);
        req.mahi.getUuid({
            account: req.owner.account.login,
            type: 'role',
            names: names
        }, function (err, lookup) {
            if (err) {
                cb(err);
                return;
            }
            var i;
            for (i = 0; i < names.length; i++) {
                if (!lookup.uuids[names[i]]) {
                    cb(new InvalidRoleTagError(names[i]));
                    return;
                }
                md.roles.push(lookup.uuids[names[i]]);
            }
            cb(null, md);
        });
    // apply all active roles if no other roles are specified
    } else if (req.caller.user) {
        md.roles = req.activeRoles;
        setImmediate(function () {
            cb(null, md);
        });
    } else {
        setImmediate(function () {
            cb(null, md);
        });
    }
}

module.exports = {
    Bucket: Bucket,
    BucketObject: BucketObject,
    getBucketIfExists: getBucketIfExists,
    createObjectMetadata: createObjectMetadata,
    loadRequest: loadRequest
};