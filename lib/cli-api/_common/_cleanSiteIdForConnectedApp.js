'use strict';

// Initialize constants
const config = require('config');

/**
 * @function _cleanSiteIdForConnectedApp
 * @description Helper function to take a siteId and clean-up so that it can be included
 * in the corresponding salesforcePlatform connectedApp ID name.
 *
 * @param siteId {String} Represents the siteId that is being incorporated into a connectedApp name
 * @returns {String} Returns the cleaned-up siteId that is now safe to use in the connectedApp name
 */
module.exports = function _cleanSiteIdForConnectedApp(siteId) {

    // Initialize local variables
    let output,
        lastCharacter,
        firstCharacter;

    // First, remove whitespace
    output = siteId.trim();

    // Next, replace all whitespace found in the site definition
    output = output.replace(config.get('connectedAppIdRegEx.whiteSpace'), '');

    // Next, replace all dashes with an underscore (to try and maintain some consistency)
    output = output.replace(config.get('connectedAppIdRegEx.dashes'), '_');

    // Replace double-underscores until none exist
    output = output.replace(config.get('connectedAppIdRegEx.doubleUnderscore'), '_');

    // Next, remove all non-alpha-numeric non-underscore characters
    output = output.replace(config.get('connectedAppIdRegEx.nonAlphaNumeric'), '');

    // Next, ensure the siteId doesn't end in an underscore
    lastCharacter = output.substr((output.length - 1), 1);

    // Was an underscore found as the last character? If so, remove it
    if (lastCharacter === '_') {
        output = output.replace(/.$/, '');
    }

    // Lastly, ensure the siteId begins with a letter
    firstCharacter = output.substr(0, 1);

    // If the first character is not a letter, replace it and default the firstCharacter with a letter
    if (!(config.get('connectedAppIdRegEx.alphaOnly')).test(firstCharacter)) {
        output = output.replace(/^./, 'a');
    }

    // Return the cleaned-up siteId for the connectedApp
    return output;

};
