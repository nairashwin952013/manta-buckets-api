/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

var auth = require('../../auth');
var buckets = require('../buckets');
var common = require('../common');
var conditional = require('../../conditional_request');
var errors = require('../../errors');

function headObject(req, res, next) {
    var owner = req.owner.account.uuid;
    var bucket = req.bucket;
    var bucketObject = req.bucketObject;
    var requestId = req.getId();
    var log = req.log;

    log.debug({
        owner: owner,
        bucket: bucket.name,
        bucket_id: bucket.id,
        object: bucketObject.name,
        requestId: requestId
    }, 'headBucketObject: requested');

    var onGetObject = function onGet(err, object_data) {
        if (err) {
            err = common.translateBucketError(req, err);

            log.debug({
                err: err,
                owner: owner,
                bucket: bucket.name,
                bucket_id: bucket.id,
                object: bucketObject.name
            }, 'headObject: error reading object metadata');

            next(err);
            return;
        }

        log.debug({
            owner: owner,
            bucket: bucket.name,
            bucket_id: bucket.id,
            object: bucketObject.name
        }, 'headObject: done');

        req.resource_exists = true;
        req.metadata = object_data;
        req.metadata.type = 'bucketobject';
        req.metadata.objectId = object_data.id;
        req.metadata.contentMD5 = object_data.content_md5;
        req.metadata.contentLength = object_data.content_length;
        req.metadata.contentType = object_data.content_type;

        // Add other needed response headers
        res.set('Etag', object_data.id);
        res.set('Last-Modified', new Date(object_data.modified));
        res.set('Durability-Level', object_data.sharks.length);
        res.set('Content-Length', object_data.content_length);
        res.set('Content-MD5', object_data.content_md5);
        res.set('Content-Type', object_data.content_type);

        Object.keys(object_data.headers).forEach(function (k) {
            if (/^m-\w+/.test(k)) {
                res.set(k, object_data.headers[k]);
            }
        });

        next();
    };

    var metadataLocation = req.metadataPlacement.getObjectLocation(owner,
        bucket.id, bucketObject.name);
    var client = req.metadataPlacement.getBucketsMdapiClient(metadataLocation);

    client.getObject(owner, bucket.id, bucketObject.name,
        metadataLocation.vnode, requestId, onGetObject);
}

module.exports = {

    headBucketObjectHandler: function headBucketObjectHandler() {
        var chain = [
            buckets.loadRequest,
            buckets.getBucketIfExists,
            headObject,
            auth.authorizationHandler(),
            conditional.conditionalRequest(),
            buckets.notFoundHandler,
            buckets.successHandler
        ];
        return (chain);
    }

};
