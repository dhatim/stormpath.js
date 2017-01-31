'use strict';

var deferCallback = require('./defer-callback');
var IdSiteRequestExecutor = require('./idsite-request-executor');
var strings = require('./strings');
var utils = require('./utils');


var base64 = utils.base64;

/**
 * Creates a Stormpath.js Client
 *
 * A client is meant to encapsulate the communication
 * with Stormpath's REST API.
 *
 * @constructor
 * @param {object} options configuration options
 * @param {function} readyCallback called when the client has
 * initialized with its needed data from the REST API.
 */
function Client (options,readyCallback) {
  var opts = typeof options === 'object' ? options : {};
  var cb = typeof options === 'function' ? options : ( readyCallback || utils.noop);
  var self = this;
  var jwtSegments = null;

  self.jwt = opts.token || self.getJwtFromUrl();

  if (!self.jwt) {
    return deferCallback(cb,[new Error(strings.errors.JWT_NOT_FOUND)]);
  }

  jwtSegments = self.jwt.split('.');

  if (jwtSegments.length < 2 || jwtSegments.length > 3) {
    return deferCallback(cb,[new Error(strings.errors.NOT_A_JWT)]);
  }

  try {
    self.jwtPayload = JSON.parse(base64.atob(jwtSegments[1]));
  } catch (e) {
    return deferCallback(cb,[new Error(strings.errors.MALFORMED_JWT_CLAIMS)]);
  }

  self.appHref = self.jwtPayload.app_href;
  self.sptoken = self.getPasswordResetToken();
  self.baseurl = self.appHref.match('(^.+?/)v\\d/')[1];

  self.idSiteParentResource = self.appHref;

  if (self.jwtPayload.onk) {
    self.setCachedOrganizationNameKey(self.jwtPayload.onk);
  }

  if (self.jwtPayload.asnk) {
    self.idSiteParentResource = self.jwtPayload.ash;
  }

  if (self.jwtPayload.require_mfa) {
    self.requireMfa = self.jwtPayload.require_mfa;
  }

  self.requestExecutor = opts.requestExecutor || new IdSiteRequestExecutor(self.jwt);

  self.requestExecutor.execute(
    {
      method: 'GET',
      url: self.idSiteParentResource + '?expand=idSiteModel,customData',
      json: true
    },
    function (err,application) {
      if (err) {
        if (err.status === 401) {
          return cb(new Error(strings.errors.SESSION_EXPIRED));
        }
        return cb(err);
      }

      /*
        Assert that the response got a new auth token header.  If it did not,
        there is likely a proxy or firewall that is stripping it from the
        response.
       */

      if (!self.requestExecutor.authToken) {
        return cb(new Error(strings.errors.NO_AUTH_TOKEN_HEADER));
      }

      if (!opts.token) {
        self.saveSessionToken();
      }

      cb(null,application.idSiteModel, application.customData);
    }
  );
}

/**
 * When storing an organization name key for future us, store it in this named
 * cookie.
 * @type {String}
 */
Client.prototype.organizationNameKeyCookieKey = 'sp.onk';

/**
 * How long we should store the organization name key cookie for. Default:
 * forever.
 * @type {String}
 */
Client.prototype.organizationNameKeyCookieExpiration = 'expires=Fri, 31 Dec 9999 23:59:59 GMT';

/**
 * Pull the cached organization name key from the organization name key cookie
 * @return {string} The cached organization name.
 */
Client.prototype.getCachedOrganizationNameKey = function () {
  return decodeURIComponent(
    document.cookie.replace(
      new RegExp('(?:(?:^|.*;)\\s*' + encodeURIComponent(this.organizationNameKeyCookieKey)
        .replace(/[\-\.\+\*]/g, '\\$&') + '\\s*\\=\\s*([^;]*).*$)|^.*$'),
      '$1'
    )
  ) || null;
};

/**
 * Store the organization name key in the organization name key cookie
 * @param {string} organization name key
 */
Client.prototype.setCachedOrganizationNameKey = function (nameKey) {
  document.cookie = encodeURIComponent(this.organizationNameKeyCookieKey) +
    '=' + encodeURIComponent(nameKey) + '; ' + this.organizationNameKeyCookieExpiration;
};

/**
 * Attempts to fetch the JWT from the ?jwt=X location in the window URL.
 * If not present, fetches from cookies.
 * Returns an empty string if not found
 * @return {string} JWT
 */
Client.prototype.getJwtFromUrl = function () {
  var jwtMatch = window.location.href.match(/jwt=([^&]+)/);
  var jwtCookie = utils.getCookie('idSiteJwt');
  if (jwtMatch) {
    window.location.replace( (window.location+'').replace(/\?jwt=([^&]+)/, '') );
    return decodeURIComponent(jwtMatch[1])
  } else if (jwtCookie) {
    document.cookie = 'idSiteJwt=' + '';
    return jwtCookie;
  } else {
    return '';
  }
};

Client.prototype.getSessionJwt = function() {
  return utils.parseJwt(this.requestExecutor.authToken);
};

Client.prototype.getSessionToken = function() {
  return this.requestExecutor.authToken;
};

Client.prototype.saveSessionToken = function() {
  // With our new access token, remove the previous access token from
  // the hash and save the new one to the cookie

  document.cookie = 'idSiteJwt=' + this.requestExecutor.authToken;
}

/**
 * Attempts to fetch the password reset token from the JWT
 * Returns an null if not found
 * @return {string} Password Reset Token
 */
Client.prototype.getPasswordResetToken = function() {
  var self = this;
  if (self.jwtPayload.sp_token) {
    return self.jwtPayload.sp_token;
  } else {
    // We need to get the token from jwt.scope.application.SLUG.passwordResetToken.SLUG
    // See https://gist.github.com/edjiang/a570a4d9e60d08492def97938b35cdfa for an example token
    var applicationId = self.appHref.match(/[^\/]+$/)[0];
    var application = self.jwtPayload.scope.application[applicationId];

    // Get all things in the application object, reduce to just the password reset token object
    var passwordResetTokens = application.map(function(contents) {
      return contents.passwordResetToken;
    }).reduce(function(previous, current) {
      return previous || current;
    }).map(function(contents) {
      // Get all password reset token objects, reduce to just the slug
      return typeof contents == 'object' ? contents : null;
    }).reduce(function(previous, current) {
      return previous || current;
    });

    // Return the password reset token or null
    return passwordResetTokens ? Object.keys(passwordResetTokens)[0] : null;
  }
}

/**
 * Make a login attempt against the REST API, given the credentials and
 * application context.
 *
 * @param  {object} credentials - Example: <pre>{ username: '', password: ''}</pre>
 * @param  {Function} callback
 */
Client.prototype.login = function login (credentials, options, callback) {
  var self = this;
  var data;
  var creds = typeof credentials === 'object' ? credentials : null;

  callback = typeof options === 'function' ? options : callback;

  if (!creds) {
    throw new Error('must provide an object');
  } else if (creds.providerData) {
    data = creds;
  } else if (creds.login) {
    data = {
      type: 'basic',
      value: utils.base64.btoa(creds.login + ':' + creds.password)
    };
  } else {
    throw new Error('unsupported credentials object');
  }

  if (creds.accountStore) {
    data.accountStore = creds.accountStore;
  }

  var queryString = null;

  if (options && options.redirect) {
    queryString = '?redirect=' + encodeURIComponent(options.redirect);
  }

  self.requestExecutor.execute(
    {
      method: 'POST',
      url: self.appHref+'/loginAttempts' + (queryString ? queryString : ''),
      json: data
    },
    callback || utils.noop
  );

};

/**
 * Make an account creation attempt against the REST API, given the input data
 * and application context.  Social login should use this method.
 *
 * @param  {object}  data - Example:
 * <pre>
 * {
 *   username: '',
 *   password: '',
 *   givenName: '',
 *   surname: ''
 * }
 * </pre>
 * Social Example:
 * <pre>
 * {
 *   providerData: {
 *     providerId: 'google',
 *     accessToken: ''
 *    }
 *  }
 * </pre>
 * @param  {Function} callback - Called back with an error or ID Site Success
 * Result
 */
Client.prototype.register = function register (data,callback) {
  if (typeof data!=='object') {
    throw new Error('client.register() must be called with a data object');
  }
  var client = this;
  client.requestExecutor.execute(
    {
      method: 'POST',
      url: client.idSiteParentResource+'/accounts',
      json: data
    },
    callback || utils.noop
  );
};

/**
 * Verify the email verification token that was embedded in the JWT that is in
 * the URL.
 *
 * @param  {Function} callback - If no error is given, the token is valid.
 */
Client.prototype.verifyEmailToken = function verifyEmailToken (callback) {
  var client = this;

  if (typeof callback!=='function') {
    throw new Error('client.verifyEmailToken() takes a function as it\'s only argument');
  }

  client.requestExecutor.execute(
    {
      method: 'POST',
      url: client.baseurl + 'v1/accounts/emailVerificationTokens/' + client.sptoken
    },
    callback
  );
};

/**
 * Verify the password reset token that was embedded in the JWT that is in the
 * URL.
 *
 * @param  {Function} callback - If no error is given, the token is valid.
 */
Client.prototype.verifyPasswordResetToken = function verifyPasswordResetToken (callback) {
  var client = this;

  if (typeof callback!=='function') {
    throw new Error('client.verifyPasswordResetToken() takes a function as it\'s only argument');
  }

  client.requestExecutor.execute(
    {
      method: 'GET',
      url: client.appHref + '/passwordResetTokens/' + client.sptoken,
      json: true
    },
    function(err, body) {
      client.saveSessionToken();
      if (callback) {
        callback(err, body);
      }
    }
  );
};

/**
 * Given the token resource, set the new password for the user.
 *
 * @param {object} passwordVerificationTokenResource -
 * Example:
 * <pre>
 * {
 *   href: 'https://api.stormpath.com/v1/applications/1h72PFWoGxHKhysKjYIkir/passwordResetTokens/3Wog2qMsHyyjD76AWUnnlO'
 * }
 * </pre>
 * @param  {Function} callback - If no error is given, the password was reset
 * successfully.  If an error, the password strength validation error will be
 * provided.
 */

Client.prototype.setAccountPassword = function setAccountPassword (passwordVerificationTokenResource,newPassword,callback) {

  var client = this;

  if (!passwordVerificationTokenResource || !passwordVerificationTokenResource.href) {
    throw new Error('invalid passwordVerificationTokenResource');
  }
  if (!newPassword) {
    throw new Error('must supply new password as second argument to client.setAccountPassword()');
  }

  client.requestExecutor.execute(
    {
      method: 'POST',
      url: passwordVerificationTokenResource.href,
      json: {
        password: newPassword
      }
    },
    callback || utils.noop
  );
};

/**
 * Given the email, send that account an email with password reset link.
 *
 * @param  {string}   email
 * @param  {Function} callback - The error will indicate if the account could
 * not be found.  Otherwise, the email was sent.
 */
Client.prototype.sendPasswordResetEmail = function sendPasswordResetEmail (emailOrObject,callback) {

  var client = this;
  var body;

  /*
    emailOrObject is a backcompat option, in the future this should be a string-only option
  */

  if (typeof emailOrObject==='string') {
    body = { email: emailOrObject };
  } else if (typeof emailOrObject === 'object') {
    body = emailOrObject;
  } else {
    throw new Error('sendPasswordResetEmail must be called with an email/username as the first argument, or an options object');
  }

  client.requestExecutor.execute(
    {
      method: 'POST',
      url: client.appHref + '/passwordResetTokens',
      json: body
    },
    callback || utils.noop
  );
};

Client.prototype.getFactors = function getFactors(account, callback) {
  if (!account || !account.href) {
    throw new Error('Client.getFactors(account[, callback]) must be called with a valid account object.');
  }

  callback = callback || utils.noop;

  var request = {
    method: 'GET',
    url: account.href + '/factors',
    json: true
  };

  this.requestExecutor.execute(request, callback);
};

Client.prototype.createFactor = function createFactor(account, data, callback) {
  if (!account || !account.href) {
    throw new Error('Client.createFactor(account, data, [, callback]) must be called with a valid account object.');
  }

  callback = callback || utils.noop;

  var request = {
    method: 'POST',
    url: account.href + '/factors',
    json: data || {}
  };

  this.requestExecutor.execute(request, callback);
};

Client.prototype.createChallenge = function (factor, data, callback) {
  // Make the data parameter optional.
  if (callback === undefined) {
    callback = data;
    data = undefined;
  }

  if (!factor || !factor.href) {
    throw new Error('Client.createChallenge(factor[, data], callback) must be called with a valid factor object.');
  }

  callback = callback || utils.noop;

  var request = {
    method: 'POST',
    url: factor.challenges.href,
    json: data || {}
  };

  this.requestExecutor.execute(request, callback);
};

Client.prototype.updateChallenge = function (challenge, data, callback) {
  if (!challenge || !challenge.href) {
    throw new Error('Client.updateChallenge(challenge, data, callback) must be called with a valid challenge object.');
  }

  callback = callback || utils.noop;

  var request = {
    method: 'POST',
    url: challenge.href,
    json: data
  };

  this.requestExecutor.execute(request, callback);
};

module.exports = Client;