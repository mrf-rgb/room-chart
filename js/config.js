// Google project values. These are public by design: the client ID only works from the allowed
// origin, and the API key is restricted to the Picker API and this site.
export const GOOGLE = {
  clientId: '',     // OAuth web client ID, ends in .apps.googleusercontent.com
  apiKey: '',       // API key restricted to the Google Picker API
  appId: '',        // Cloud project number (digits only)
};

export const FILES = {
  data: 'class-tracker-data.json',
  inbox: 'class-tracker-inbox.json',
};

export const VERSION = '1.0.0';
