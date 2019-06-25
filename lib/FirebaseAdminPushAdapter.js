'use strict';

const admin = require('firebase-admin');
const log = require('npmlog');

if (process.env.VERBOSE || process.env.VERBOSE_PARSE_SERVER_PUSH_ADAPTER) {
  log.level = 'verbose';
}

const LOG_PREFIX = 'firebase-admin-push-adapter';
const defaultMaxTokensPerRequest = 1000;
const FCMTimeToLiveMax = 4 * 7 * 24 * 60 * 60; // FCM allows a max of 4 weeks

class FirebaseAdminPushAdapter {
  constructor(pushConfig = {}) {
    this.validPushTypes = ['ios', 'osx', 'tvos', 'android', 'fcm', 'web'];

    const {
      maxTokensPerRequest = defaultMaxTokensPerRequest, serviceAccountKey, databaseURL
    } = pushConfig;

    if (!serviceAccountKey || !databaseURL) {
      throw new Error('Trying to initialize FirebaseAdminPushAdapter without serviceAccountKey / databaseURL');
    }

    this.maxTokensPerRequest = maxTokensPerRequest;

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountKey),
      databaseURL: databaseURL
    });
  }

  getValidPushTypes() {
    return this.validPushTypes;
  }

  getValidTokens(installations) {
    return this.getValidInstallations(installations).map(installation => installation.deviceToken);
  }

  getValidInstallations(installations) {
    return installations.filter(
      installation => ~this.validPushTypes.indexOf(installation.deviceType) && installation.deviceToken
    ).map(installation => installation);
  }

  send(data, installations) {
    const validInstallations = this.getValidInstallations(installations);
    const tokens = this.getValidTokens(validInstallations);
    const chunks = [];
    const chunkInstallations = [];
    let i = 0;

    while (i < tokens.length) {
      let end = i + this.maxTokensPerRequest;
      chunks.push(tokens.slice(i, end));
      chunkInstallations.push(validInstallations.slice(i, end));
      i = end;
    }

    let timestamp = Date.now();
    let expirationTime;
    // We handle the expiration_time convertion in push.js, so expiration_time is a valid date
    // in Unix epoch time in milliseconds here
    if (data['expiration_time']) {
      expirationTime = data['expiration_time'];
    }

    // Generate FCM payload
    let fcmPayload = this.generatePayload(data);
    let fcmOptions = this.generateOptions(data, timestamp, expirationTime);

    return chunks.reduce(
      (pr, deviceTokens, idx) => pr.then(
        () => this.sendToDevice(chunkInstallations[idx], deviceTokens, fcmPayload, fcmOptions)
      ), Promise.resolve()
    );
  }

  /**
  * Generate the fcm payload from the data we get from api request.
  * @param {Object} requestData The request body
  * @returns {Object} A promise which is resolved after we get results from fcm
  */
  generatePayload(requestData) {
    requestData = requestData.data || {};

    const {
      badge, alert, sound, title, body, uri, icon, color, topic, ...customData
    } = requestData;

    const notification = {};

    if (typeof badge !== 'undefined' && badge !== null) {
      if (badge === 'Increment') {
        notification.badge = '+1';
      } else {
        notification.badge = badge.toString();
      }
    }

    if (alert) {
      notification.body = alert;
    }

    if (title) {
      notification.title = title;
    }

    if (body) {
      notification.body = body;
    }

    if (uri) {
      notification.link = uri;
    }

    if (sound) {
      notification.sound = sound;
    }

    if (icon) {
      notification.icon = icon;
    }

    if (color) {
      notification.color = color;
    }

    const payload = {
      notification: notification
    };

    if (topic) {
      payload.topic = topic;
    }

    if (Object.keys(customData).length > 0) {
      payload.data = customData;
    }

    return payload;
  }

  /**
  * Generate the fcm options from the data we get from api request.
  * @param {Object} requestData The request body
  * @param {Number} timestamp A number whose format is the Unix Epoch
  * @param {Number|undefined} expirationTime A number whose format is the Unix Epoch or undefined
  * @returns {Object} A promise which is resolved after we get results from fcm
  */
  generateOptions(requestData, timestamp, expirationTime) {
    requestData = requestData.data || {};

    const {
      'content-available': contentAvailable, 'mutable-content': mutableContent, collapseKey
    } = requestData;

    let options = {
      priority: 'high'
    };

    if (contentAvailable == 1) {
      options.contentAvailable = 1;
    }

    if (mutableContent == 1) {
      options.mutableContent = 1;
    }

    if (collapseKey) {
      options.collapseKey = collapseKey;
    }

    if (expirationTime) {
      // The timestamp and expiration is in milliseconds but fcmd requires second
      let timeToLive = Math.floor((expirationTime - timestamp) / 1000);
      if (timeToLive < 0) {
        timeToLive = 0;
      }
      if (timeToLive >= FCMTimeToLiveMax) {
        timeToLive = FCMTimeToLiveMax;
      }
      options.timeToLive = timeToLive;
    }

    return options;
  }

  /**
   * sendToDevice
   * @param {Array} installations
   * @param {Array} deviceTokens
   * @param {Object} payload
   * @param {Object} options
   *
   * @returns {Object} A promise
   */
  async sendToDevice(installations, deviceTokens, payload, options) {
    let length = deviceTokens.length;
    log.verbose(LOG_PREFIX, `sending to ${length} ${length > 1 ? 'devices' : 'device'}`);

    try {
      const response = await admin.messaging().sendToDevice(deviceTokens, payload, options);

      log.verbose(LOG_PREFIX, `GCM Response: %s`, JSON.stringify(response, null, 4));

      const resolutions = [];
      let {
        results, multicastId, canonicalRegistrationTokenCount = 0, failureCount = 0, successCount = 0
      } = response || {};


      installations.forEach(installation => {
        let idx = deviceTokens.indexOf(installation.deviceToken);
        let result = results && results[idx] ? results[idx] : undefined;

        let device = {
          deviceToken: installation.deviceToken,
          deviceType: installation.deviceType,
          appIdentifier: installation.appIdentifier
        };

        let resolution = {
          device,
          multicastId,
          canonicalRegistrationTokenCount,
          failureCount,
          successCount,
          response: result
        };

        if (!result || result.error) {
          resolution.transmitted = false;
        } else {
          resolution.transmitted = true;
        }

        resolutions.push(resolution);
      });

      return resolutions;
    } catch (error) {
      log.error(LOG_PREFIX, `send errored: % s`, JSON.stringify(error, null, 4));

      throw error;
    }
  }
}

module.exports = FirebaseAdminPushAdapter;
