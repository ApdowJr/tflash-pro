import selfModification from "eve/self-modification/local";

// `next dev` starts Eve with its bundled development extension. This chat app
// can be reached by multiple accounts, so they must not edit the app source.
export default selfModification({ local: { enabled: false } });
