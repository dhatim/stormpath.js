'use strict';

/**
 * @function
 * From: https://developer.mozilla.org/en-US/docs/Web/API/WindowBase64/Base64_encoding_and_decoding#Solution_.232_.E2.80.93_rewriting_atob()_and_btoa()_using_TypedArrays_and_UTF-8
 */

function b64EncodeUnicode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
    return String.fromCharCode('0x' + p1);
  }));
}

function base64urlToBase64(base64){
    return base64.replace(/-/g, '+').replace(/_/g, '/');
}

module.exports = {
  base64: {
    decodeBase64Url: function (str){
      return decodeURIComponent(window.atob(base64urlToBase64(str)));
    },
    btoa: function btoa(str){
      var v = b64EncodeUnicode(str);
      return v;
    }
  },
  noop: function(){}
};