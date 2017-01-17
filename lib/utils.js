'use strict';

var Buffer = require('buffer/').Buffer;

/**
 * @function
 * From: https://developer.mozilla.org/en-US/docs/Web/API/WindowBase64/Base64_encoding_and_decoding#Solution_.232_.E2.80.93_rewriting_atob()_and_btoa()_using_TypedArrays_and_UTF-8
 */

function b64EncodeUnicode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
    return String.fromCharCode('0x' + p1);
  }));
}

function base64Encode(str) {
  return new Buffer(str,'base64').toString();
}

function base64Decode(str) {
  var v = b64EncodeUnicode(str);
  return v;
}

function getCookie(name) {
  var cookie = document.cookie.match(new RegExp(name + '=([^;]+)'));
  if (cookie) {
    return cookie[1];
  }
}

function parseJwt(rawJwt) {
  if (!rawJwt) {
    return false;
  }

  var segments = rawJwt.split('.', 3);

  if (!segments || segments.length !== 3) {
    return false;
  }

  return {
    header: JSON.parse(atob(segments[0])),
    body: JSON.parse(atob(segments[1])),
    signature: segments[2],
    toString: function () {
      return rawJwt;
    }
  };
}

module.exports = {
  base64: {
    atob: base64Encode,
    btoa: base64Decode
  },
  noop: function(){},
  parseJwt: parseJwt,
  getCookie: getCookie
};
