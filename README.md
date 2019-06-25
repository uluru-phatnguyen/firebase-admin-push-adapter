# firebase-admin-push-adapter
Firebase Admin push adapter for parse-server using `firebase-admin` module.

Support push for both devices iOS and Android based on FCM.

Note: We must to config APNs in FCM at Project Settings at https://console.firebase.google.com/

## Installation

```
npm install git+https://github.com/uluru-phatnguyen/firebase-admin-push-adapter.git
```

## Usage
Go to `Service Accounts` in Project Settings
- Download `serviceAccount.json` from click `Generate new private key` button
- Copy databaseURL.

Note: `serviceAccountKey` use json file or server key.

```js
const FirebaseAdminPushAdapter = require('firebase-admin-push-adapter');
const fbaseAdminPushAdapter = new FirebaseAdminPushAdapter({
  serviceAccountKey: require(path + 'serviceAccount.json'),
  databaseURL: 'your-fcm-database'
});

var api = new ParseServer({
  push: {
    adapter: fbaseAdminPushAdapter
  },
  ...otherOptions
});
```
