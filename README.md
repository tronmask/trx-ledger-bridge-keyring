# trx-ledger-bridge-keyring [![CircleCI](https://circleci.com/gh/tronmask/trx-ledger-bridge-keyring.svg?style=svg)](https://circleci.com/gh/tronmask/trx-ledger-bridge-keyring)

An implementation of TronMask's [Keyring interface](https://github.com/tronmask/trx-simple-keyring#the-keyring-class-protocol), that uses a Ledger hardware wallet for all cryptographic operations.

In most regards, it works in the same way as
[trx-hd-keyring](https://github.com/tronmask/trx-hd-keyring), but using a Ledger
device. However there are a number of differences:

- Because the keys are stored in the device, operations that rely on the device
  will fail if there is no Ledger device attached, or a different Ledger device
  is attached.

- It does not support the `signMessage`, `signTypedData` or `exportAccount`
  methods, because Ledger devices do not support these operations.

- Because extensions have limited access to browser features, there's no easy way to interact wth the Ledger Hardware wallet from the TronMask extension. This library implements a workaround to those restrictions by injecting (on demand) an iframe to the background page of the extension, (which is hosted [here](https://metamask.github.io/trx-ledger-bridge-keyring/index.html).

The iframe is allowed to interact with the Ledger device (since U2F requires SSL and the iframe is hosted under https) using the libraries from [LedgerJS](https://github.com/LedgerHQ/ledgerjs) _hw-app-eth_ and _hw-transport-u2f_ and establishes a two-way communication channel with the extension via postMessage.

The iframe code it's hosted in the same repo under the branch [gh-pages](https://github.com/TronMask/trx-ledger-bridge-keyring/tree/gh-pages) and it's being served via github pages. In the future we might move it under the metamask.io domain.

## Usage

In addition to all the known methods from the [Keyring class protocol](https://github.com/TronMask/trx-simple-keyring#the-keyring-class-protocol),
there are a few others:

- **isUnlocked** : Returns true if we have the public key in memory, which allows to generate the list of accounts at any time

- **unlock** : Connects to the Ledger device and exports the extended public key, which is later used to read the available ethereum addresses inside the Ledger account.

- **setAccountToUnlock** : the index of the account that you want to unlock in order to use with the signTransaction and signPersonalMessage methods

- **getFirstPage** : returns the first ordered set of accounts from the Ledger account

- **getNextPage** : returns the next ordered set of accounts from the Ledger account based on the current page

- **getPreviousPage** : returns the previous ordered set of accounts from the Ledger account based on the current page

- **forgetDevice** : removes all the device info from memory so the next interaction with the keyring will prompt the user to connect the Ledger device and export the account information

## Testing

Run the following command:

```
npm test
```

## Attributions

This code was inspired by [trx-ledger-keyring](https://github.com/jamespic/eth-ledger-keyring) and [eth-hd-keyring](https://github.com/MetaMask/eth-hd-keyring)
