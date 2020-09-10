For testing:

```
npm install
npm start
```

Open https://localhost:3000

In dev console:

```javascript
window.postMessage({
  target: "LEDGER-IFRAME",
  action: "ledger-unlock",
  params: { hdPath: "44'/195'/0'" },
});
```

Connect ledger to computer, unlock and select Tron app. You should see
`message sent` with a successful response sent.
