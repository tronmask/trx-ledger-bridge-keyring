const { EventEmitter } = require('events')
const { ethAddress } = require('@opentron/tron-eth-conversions')
const HDKey = require('hdkey')
const ethUtil = require('ethereumjs-util')
const sigUtil = require('eth-sig-util')
const { getTransaction } = require('@opentron/tron-sig-util');

// Tron's HD path
const hdPathString = `m/44'/195'/0'`
// const hdPathString = `m/44'/60'/0'`;
const type = 'Ledger Hardware'
const BRIDGE_URL = 'https://tronmask.github.io/trx-ledger-bridge-keyring'
const pathBase = 'm'
const MAX_INDEX = 1000

// @TODO(tron)
/*
const NETWORK_API_URLS = {
  ropsten: 'http://api-ropsten.etherscan.io',
  kovan: 'http://api-kovan.etherscan.io',
  rinkeby: 'https://api-rinkeby.etherscan.io',
  mainnet: 'https://api.etherscan.io',
}
*/

function hex (buf) {
  return `0x${buf.toString('hex')}`
}

function txToTxParams (tx) {
  return {
    to: hex(tx.to),
    // warning: throws if tx is not signed...
    // from: hex(tx.from),
    value: hex(tx.value),
    nonce: hex(tx.nonce),
    gasPrice: hex(tx.gasPrice),
    gasLimit: hex(tx.gasLimit),
    data: hex(tx.data),
  }
}

class LedgerBridgeKeyring extends EventEmitter {
  constructor (opts = {}) {
    super()
    // console.log('LedgerBridgeKeyring', this)
    this.accountIndexes = {}
    this.bridgeUrl = null
    this.type = type
    this.page = 0
    this.perPage = 5
    this.unlockedAccount = 0
    this.hdk = new HDKey()
    this.paths = {}
    this.iframe = null
    this.network = 'mainnet'
    this.implementFullBIP44 = false
    this.deserialize(opts)
    this._setupIframe()
  }

  async serialize () {
    return {
      hdPath: this.hdPath,
      accounts: this.accounts,
      accountIndexes: this.accountIndexes,
      bridgeUrl: this.bridgeUrl,
      implementFullBIP44: false,
    }
  }

  deserialize (opts = {}) {
    this.hdPath = opts.hdPath || hdPathString
    this.bridgeUrl = opts.bridgeUrl || BRIDGE_URL
    this.accounts = opts.accounts || []
    this.accountIndexes = opts.accountIndexes || {}
    this.implementFullBIP44 = opts.implementFullBIP44 || false

    if (this._isBIP44()) {
      // Remove accounts that don't have corresponding account indexes
      this.accounts = this.accounts.filter((account) => Object.keys(this.accountIndexes).includes(
        ethUtil.toChecksumAddress(account),
      ))
    }

    return Promise.resolve()
  }

  isUnlocked () {
    return Boolean(this.hdk && this.hdk.publicKey)
  }

  setAccountToUnlock (index) {
    this.unlockedAccount = parseInt(index, 10)
  }

  setHdPath (hdPath) {
    // Reset HDKey if the path changes
    if (this.hdPath !== hdPath) {
      this.hdk = new HDKey()
    }
    this.hdPath = hdPath
  }

  unlock (hdPath) {
    if (this.isUnlocked() && !hdPath) {
      return Promise.resolve('already unlocked')
    }
    const path = hdPath ? this._toLedgerPath(hdPath) : this.hdPath
    return new Promise((resolve, reject) => {
      this._sendMessage(
        {
          action: 'ledger-unlock',
          params: {
            hdPath: path,
          },
        },
        ({ success, payload }) => {
          console.log({ success, payload })
          if (success) {
            this.hdk.publicKey = Buffer.from(payload.publicKey, 'hex')
            // Tron bridge does not return "chainCode"
            // this.hdk.chainCode = Buffer.from(payload.chainCode, 'hex')
            // Tron bridge returns address in Tron format, convert back to hex format
            const address = ethAddress.fromTron(payload.address)
            resolve(address)
          } else {
            reject(payload.error || 'Unknown error')
          }
        },
      )
    })
  }

  async addAccounts (n = 1) {
    await this.unlock()
    const from = this.unlockedAccount
    const to = from + n
    this.accounts = []
    for (let i = from; i < to; i++) {
      let address
      if (this._isBIP44()) {
        const path = this._getPathForIndex(i)
        address = await this.unlock(path)
        this.accountIndexes[ethUtil.toChecksumAddress(address)] = i
      } else {
        address = this._addressFromIndex(pathBase, i)
      }
      this.accounts.push(address)
      this.page = 0
    }
    return this.accounts
  }

  getFirstPage () {
    this.page = 0
    return this.__getPage(1)
  }

  getNextPage () {
    return this.__getPage(1)
  }

  getPreviousPage () {
    return this.__getPage(-1)
  }

  getAccounts () {
    return Promise.resolve(this.accounts.slice())
  }

  removeAccount (address) {
    if (
      !this.accounts.map((a) => a.toLowerCase()).includes(address.toLowerCase())
    ) {
      throw new Error(`Address ${address} not found in this keyring`)
    }
    this.accounts = this.accounts.filter(
      (a) => a.toLowerCase() !== address.toLowerCase(),
    )
    delete this.accountIndexes[ethUtil.toChecksumAddress(address)]
  }

  // tx is an instance of the ethereumjs-transaction class.
  async signTransaction (address, tx) {
    const txParams = {
      ...txToTxParams(tx),
      from: address,
    }
    const tronTx = await getTransaction(txParams, { chainId: tx.getChainId() })

    // todo
    const txHex = tronTx.raw_data_hex

    await this.unlock()

    // tx.v = ethUtil.bufferToHex(tx.getChainId())
    // tx.r = '0x00'
    // tx.s = '0x00'

    let hdPath
    if (this._isBIP44()) {
      const checksummedAddress = ethUtil.toChecksumAddress(address)
      if (!Object.keys(this.accountIndexes).includes(checksummedAddress)) {
        throw new Error(
          `Ledger: Index for address '${checksummedAddress}' not found`,
        )
      }
      hdPath = this._getPathForIndex(
        this.accountIndexes[checksummedAddress],
      )
    } else {
      hdPath = this._toLedgerPath(this._pathFromAddress(address))
    }

    const { success, payload } = await this._sendMessageAsync({
      action: 'ledger-sign-transaction',
      params: {
        // TODO: tron serialization!
        tx: txHex,
        hdPath,
        to: ethUtil.bufferToHex(tx.to).toLowerCase(),
      },
    })
    if (success) {
      // tx.v = Buffer.from(payload.v, 'hex')
      // tx.r = Buffer.from(payload.r, 'hex')
      // tx.s = Buffer.from(payload.s, 'hex')

      // const valid = tx.verifySignature()
      const valid = true // todo
      if (valid) {
        return tx
      }
      throw new Error('Ledger: The transaction signature is not valid')
    } else {
      throw new Error(
        payload.error ||
        'Ledger: Unknown error while signing transaction',
      )
    }
  }

  signMessage (withAccount, data) {
    return this.signPersonalMessage(withAccount, data)
  }

  // For personal_sign, we need to prefix the message:
  signPersonalMessage (withAccount, message) {
    return new Promise((resolve, reject) => {
      this.unlock().then((_) => {
        let hdPath
        if (this._isBIP44()) {
          const checksummedAddress = ethUtil.toChecksumAddress(withAccount)
          if (!Object.keys(this.accountIndexes).includes(checksummedAddress)) {
            reject(
              new Error(
                `Ledger: Index for address '${checksummedAddress}' not found`,
              ),
            )
          }
          hdPath = this._getPathForIndex(
            this.accountIndexes[checksummedAddress],
          )
        } else {
          hdPath = this._toLedgerPath(this._pathFromAddress(withAccount))
        }

        this._sendMessage(
          {
            action: 'ledger-sign-personal-message',
            params: {
              hdPath,
              message: ethUtil.stripHexPrefix(message),
            },
          },
          ({ success, payload }) => {
            if (success) {
              let v = payload.v - 27
              v = v.toString(16)
              if (v.length < 2) {
                v = `0${v}`
              }
              const signature = `0x${payload.r}${payload.s}${v}`
              // @TODO: port to tron
              const addressSignedWith = sigUtil.recoverPersonalSignature({
                data: message,
                sig: signature,
              })
              if (
                ethUtil.toChecksumAddress(addressSignedWith) !==
                ethUtil.toChecksumAddress(withAccount)
              ) {
                reject(
                  new Error(
                    'Ledger: The signature doesnt match the right address',
                  ),
                )
              }
              resolve(signature)
            } else {
              reject(
                new Error(
                  payload.error || 'Ledger: Uknown error while signing message',
                ),
              )
            }
          },
        )
      })
    })
  }

  signTypedData () {
    throw new Error('Not supported on this device')
  }

  exportAccount () {
    throw new Error('Not supported on this device')
  }

  forgetDevice () {
    this.accounts = []
    this.page = 0
    this.unlockedAccount = 0
    this.paths = {}
    this.hdk = new HDKey()
  }

  /* PRIVATE METHODS */

  _setupIframe () {
    this.iframe = document.createElement('iframe')
    this.iframe.src = this.bridgeUrl
    document.head.appendChild(this.iframe)
  }

  _getOrigin () {
    const tmp = this.bridgeUrl.split('/')
    tmp.splice(-1, 1)
    return tmp.join('/')
  }

  _sendMessage (msg, cb) {
    msg.target = 'LEDGER-IFRAME'
    console.log('_sendMessage', msg)
    this.iframe.contentWindow.postMessage(msg, '*')
    const eventListener = ({ origin, data }) => {
      if (origin !== this._getOrigin()) {
        return false
      }
      if (data && data.action && data.action === `${msg.action}-reply`) {
        cb(data)
        return undefined
      }
      window.removeEventListener('message', eventListener)
      return undefined
    }
    window.addEventListener('message', eventListener)
  }

  async _sendMessageAsync (msg) {
    return new Promise((resolve, _reject) => {
      this._sendMessage(msg, (data) => {
        return resolve(data)
      })
    })
  }

  async __getPage (increment) {
    try {
      this.page += increment

      if (this.page <= 0) {
        this.page = 1
      }
      const from = (this.page - 1) * this.perPage
      const to = from + this.perPage

      await this.unlock()
      let accounts
      if (this._isBIP44()) {
        accounts = await this._getAccountsBIP44(from, to)
      } else {
        accounts = this._getAccountsLegacy(from, to)
      }
      return accounts
    } catch (err) {
      console.error("__getPage error", err)
      throw err
    }
  }

  async _getAccountsBIP44 (from, to) {
    const accounts = []

    for (let i = from; i < to; i++) {
      const path = this._getPathForIndex(i)
      const address = await this.unlock(path)
      const valid = this.implementFullBIP44
        ? await this._hasPreviousTransactions(address)
        : true
      accounts.push({
        address,
        balance: null,
        index: i,
      })
      // PER BIP44
      // "Software should prevent a creation of an account if
      // a previous account does not have a transaction history
      // (meaning none of its addresses have been used before)."
      if (!valid) {
        break
      }
    }
    return accounts
  }

  _getAccountsLegacy (from, to) {
    const accounts = []

    for (let i = from; i < to; i++) {
      const address = this._addressFromIndex(pathBase, i)
      accounts.push({
        address,
        balance: null,
        index: i,
      })
      this.paths[ethUtil.toChecksumAddress(address)] = i
    }
    return accounts
  }

  _padLeftEven (hexStr) {
    return hexStr.length % 2 === 0 ? hexStr : `0${hexStr}`
  }

  _normalize (buf) {
    return this._padLeftEven(ethUtil.bufferToHex(buf).toLowerCase())
  }

  // eslint-disable-next-line no-shadow
  _addressFromIndex (pathBase, i) {
    const dkey = this.hdk.derive(`${pathBase}/${i}`)
    const address = ethUtil
      .publicToAddress(dkey.publicKey, true)
      .toString('hex')
    return ethUtil.toChecksumAddress(address)
  }

  _pathFromAddress (address) {
    const checksummedAddress = ethUtil.toChecksumAddress(address)
    let index = this.paths[checksummedAddress]
    if (typeof index === 'undefined') {
      for (let i = 0; i < MAX_INDEX; i++) {
        if (checksummedAddress === this._addressFromIndex(pathBase, i)) {
          index = i
          break
        }
      }
    }

    if (typeof index === 'undefined') {
      throw new Error('Unknown address')
    }
    return this._getPathForIndex(index)
  }

  _toAscii (hexStr) {
    let str = ''
    let i = 0
    const l = hexStr.length
    if (hexStr.substring(0, 2) === '0x') {
      i = 2
    }
    for (; i < l; i += 2) {
      const code = parseInt(hexStr.substr(i, 2), 16)
      str += String.fromCharCode(code)
    }

    return str
  }

  _getPathForIndex (index) {
    // Check if the path is BIP 44 (Ledger Live)
    return this._isBIP44()
      ? `m/44'/195'/${index}'/0/0`
      : `${this.hdPath}/${index}`
  }

  _isBIP44 () {
    return this.hdPath === `m/44'/195'/0'/0/0`
  }

  _toLedgerPath (path) {
    return path.toString().replace('m/', '')
  }

  async _hasPreviousTransactions (_address) {
    return true
  }

  // TODO: port to tron. i think we can use java-tron api directly
  /*
  async _hasPreviousTransactions(address) {
    const apiUrl = this._getApiUrl();
    const response = await window.fetch(
      `${apiUrl}/api?module=account&action=txlist&address=${address}&tag=latest&page=1&offset=1`
    );
    const parsedResponse = await response.json();
    if (parsedResponse.status !== "0" && parsedResponse.result.length > 0) {
      return true;
    }
    return false;
  }

  _getApiUrl() {
    return `TODO_TRON_NETWORK_API_URL (${this.network})`;
  }
  */
}

LedgerBridgeKeyring.type = type
module.exports = LedgerBridgeKeyring
