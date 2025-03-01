'use strict';

/**
 * @module ServiceMgr
 */

/**
 * @type {dw/system/Logger}
 */
var LOGGER = require('dw/system/Logger').getLogger('int_b2ccrmsync', 'ServiceMgr');

/**
 * Returns the service related to the given {serviceName} initialized with the given {definition}
 *
 * @param {String} serviceName The name of the prefix to initialize
 * @param {Object} definition The definition to use while initializing the service
 *
 * @return {dw/svc/Service} A new service instance
 */
function getService(serviceName, definition) {
    return require('dw/svc/LocalServiceRegistry').createService(getServiceID(serviceName, definition), definition);
}

/**
 * Get the country code from the current locale
 *
 * @return {String} The country code found from the request locale
 */
function getCountryCodeFromCurrentLocale() {
    if (!request.locale) {
        return '';
    }

    var currentLocaleParsed = request.locale.split('_');
    return currentLocaleParsed[currentLocaleParsed.length > 1 ? 1 : 0];
}

/**
 * Returns the list of possible IDs based on the current site and country
 *
 * @param {String} id The id to use as prefix while generating the list of possible IDs for service and credentials
 *
 * @return {Array} The array of possible IDs to test to support credentials per site, or per country
 */
function getPossibleIDs(id) {
    var siteID = require('dw/system/Site').getCurrent().getID();
    var countryID = getCountryCodeFromCurrentLocale().toUpperCase();
    return [
        id + '.' + siteID + '.' + countryID,
        id + '.' + siteID,
        id + '.' + countryID,
        id
    ];
}

/**
 * Build the service ID based on the current site and country from the request locale
 * This allows to have services per sites and per countries if required
 *
 * @param {String} serviceName The name of the prefix to initialize
 * @param {Object} definition The definition to use while initializing the service
 *
 * @return {String} The found service ID
 */
function getServiceID(serviceName, definition) {
    var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
    var possibleIDs = getPossibleIDs(serviceName);
    definition = definition || {};

    var existingIDs = possibleIDs.filter(function tryInitializingService(id) {
        try {
            LOGGER.debug('Trying to initialize the {0} service name with the id {1}.', serviceName, id);
            LocalServiceRegistry.createService(id, definition);
            return true;
        } catch (e) {
            LOGGER.debug('Requested Service is not configured: {0}. {1}', id, e);
            return false;
        }
    });

    return (existingIDs && existingIDs[0]) || undefined;
}

/**
 * Attempt to set to site-specific credential to the given service. If it fails, fallback to the original ID
 *
 * @param  {dw/svc/HTTPService} svc The service on which to apply the credentials
 * @param  {String} id The id of the credential to apply
 *
 * @return {String}
 */
function setCredentialID(svc, id) {
    var possibleIDs = getPossibleIDs(id);

    possibleIDs.some(function tryToApplyCredentialID(credentialID) {
        try {
            LOGGER.debug('Trying to apply the credential that matches the {0} id on the given service.', id);
            svc.setCredentialID(credentialID);
            return true;
        } catch (e) {
            LOGGER.debug('Requested credential is not configured: {0}, {1}', id, e);
            return false;
        }
    });
}


module.exports = {
    /**
     * Returns a new instance of the Salesforce Core Auth Service
     *
     * @returns {dw/svc/Service}
     */
    getAuthService: function () {
        return getService(require('../b2ccrmsync.config').services.auth, {
            /**
             * Create request for service authentication
             *
             * @param {dw/svc/HTTPService} svc
             *
             * @throws {Error} Throws error when service credentials are missing
             */
            createRequest: function (svc) {
                setCredentialID(svc, svc.getCredentialID() || svc.getConfiguration().getID());

                LOGGER.debug('Auth service, using the following credential ID: {0}', svc.getCredentialID());

                var svcCredential = svc.getConfiguration().getCredential();
                if (!svcCredential || !svcCredential.getUser() || !svcCredential.getPassword()) {
                    throw new Error('Auth service, service configuration requires valid username and password');
                }

                svc.setAuthentication('NONE');
                svc.addHeader('Content-Type', 'application/x-www-form-urlencoded');
                svc.setRequestMethod('POST');
                svc.addParam('grant_type', 'password');
                svc.addParam('username', svcCredential.getUser());
                svc.addParam('password', svcCredential.getPassword());
                svc.addParam('client_id', svcCredential.custom.consumerKey);
                svc.addParam('client_secret', svcCredential.custom.consumerSecret);
            },
            /**
             * @param {dw/svc/HTTPService} svc
             * @param {dw/net/HTTPClient} client
             *
             * @returns {Object}
             */
            parseResponse: function (svc, client) {
                var responseObj = require('../util/helpers').expandJSON(client.text, client.text);
                if (responseObj && responseObj.access_token) {
                    LOGGER.debug('Auth service, access token successfully retrieved: {0}', responseObj.access_token);
                }

                return responseObj;
            },
            mockFull: function () {
                return require('./mocks/auth');
            },
            getRequestLogMessage: function (request) {
                LOGGER.debug(JSON.stringify(request));
            },
            getResponseLogMessage: function (response) {
                LOGGER.debug(JSON.stringify(response.getText()));
            }
        });
    },

    /**
     * Gets the REST Service according to the given {model} and {state} and calls it.
     * In case it fails with a 401 error, then retry until the {maxServiceRetry} config limit is reached
     *
     * @param {String} model The model of the service
     * @param {String} state The state of the service
     * @param {Object} requestBody The request body to send to the service
     * @param {Boolean} bypassCache If true, then the authentication token will be retrieved from the Salesforce Core Platform, not from the cache
     * @param {Number} callCounter The variable that counts the calls we do, and so ensure we don't reach the {maxServiceRetry} limit
     *
     * @returns {Object}
     */
    callRestService: function callRestService(model, state, requestBody, bypassCache, callCounter) {
        var config = require('../b2ccrmsync.config');
        var maxServiceRetry = config.maxServiceRetry || 1;
        callCounter = callCounter || 0;
        var svc = getService(config.services.rest, require('./rest').getServiceCallback(model, state, bypassCache));
        var result = svc.call(requestBody);
        callCounter++;

        if (result.status !== 'OK' && result.error === 401 && callCounter <= maxServiceRetry) {
            // Always bypass the custom cache in case of a retry, to ensure getting the auth token from the Salesforce Core Platform
            return module.exports.callRestService(model, state, requestBody, true, callCounter);
        }

        return result;
    }
};
