// MUST stay the first import: ES imports are hoisted and evaluated in source
// order, so this installs the WeakRef shim before any other module body runs.
import './src/polyfills';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
