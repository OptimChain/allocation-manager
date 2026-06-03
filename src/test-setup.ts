// Polyfills required by react-router v7+ in jsdom
import { TextEncoder, TextDecoder } from 'util';

Object.assign(global, { TextEncoder, TextDecoder });
