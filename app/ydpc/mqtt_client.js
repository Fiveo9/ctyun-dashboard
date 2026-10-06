/**
 * 移动云电脑 - 原生轻量级 MQTT 3.1.1 over TLS 长连接保活客户端
 * (100% 纯 Node.js 内置 tls 模块实现，零外部依赖，对齐官方 UOS 客户端规范)
 */

const tls = require('tls');
const crypto = require('crypto');
const net = require('net');

const MQTT_CERT_CHAIN_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function mqttCertChainError(error) {
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (MQTT_CERT_CHAIN_ERROR_CODES.has(current.code)) return current.code;
  }
  return null;
}

function encodeRemainingLength(length) {
  const buffer = [];
  let x = length;
  do {
    let encodedByte = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) {
      encodedByte |= 128;
    }
    buffer.push(encodedByte);
  } while (x > 0);
  return Buffer.from(buffer);
}

function encodeString(str) {
  const buf = Buffer.from(str || '', 'utf8');
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(buf.length, 0);
  return Buffer.concat([lenBuf, buf]);
}

/**
 * 构造 MQTT 3.1.1 CONNECT 报文
 */
function buildMqttConnectPacket(clientId, username, password, keepAliveSeconds = 60) {
  // 1. 可变报头 (Variable Header)
  const protoName = encodeString('MQTT');
  const protoLevel = Buffer.from([0x04]); // 3.1.1 规范
  const connectFlags = Buffer.from([0xC2]); // Clean Session (0x02) + User Name (0x80) + Password (0x40)
  const keepAliveBuf = Buffer.alloc(2);
  keepAliveBuf.writeUInt16BE(keepAliveSeconds, 0);

  const varHeader = Buffer.concat([protoName, protoLevel, connectFlags, keepAliveBuf]);

  // 2. 有效载荷 (Payload)
  const payloadClientId = encodeString(clientId);
  const payloadUsername = encodeString(username);
  const payloadPassword = encodeString(password);

  const payload = Buffer.concat([payloadClientId, payloadUsername, payloadPassword]);

  // 3. 固定报头 (Fixed Header)
  const remLength = varHeader.length + payload.length;
  const fixedHeader = Buffer.concat([Buffer.from([0x10]), encodeRemainingLength(remLength)]);

  return Buffer.concat([fixedHeader, varHeader, payload]);
}

/**
 * 构造 MQTT PINGREQ 心跳报文 (2 字节)
 */
function buildMqttPingReqPacket() {
  return Buffer.from([0xC0, 0x00]);
}

class MqttKeepAliveClient {
  constructor(options = {}) {
    this.host = options.host || 'alive.soho.komect.com';
    const rawPort = Number(options.port);
    this.port = (rawPort && rawPort !== 443) ? rawPort : 8883;
    this.clientId = options.clientId || `client_${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;
    this.username = options.username || '';
    this.password = options.password || '';
    this.keepAliveSeconds = Number(options.keepAliveSeconds) || 60;
    this.onLog = options.onLog || console.log;
    this.allowInsecure = options.allowInsecure === true;

    this.socket = null;
    this.isConnected = false;
    this.pingTimer = null;
    this.isClosedManually = false;
    this.lastPingTime = 0;
    this.lastPongTime = 0;
  }

  /**
   * 建立 TLS 连接并完成 MQTT CONNECT 握手
   */
  async connect(timeoutMs = 15000) {
    if (this.socket) {
      this.disconnect();
    }
    this.isClosedManually = false;

    // 1. 双栈网络智能选路：优先选取 IPv4 地址，彻底消除 Docker 容器/宿主机双栈网络下因 IPv6 无网关导致的 10 秒超时假死
    const dns = require('dns');
    const targetIp = await new Promise((res) => {
      dns.lookup(this.host, { all: true }, (err, addresses) => {
        if (!err && Array.isArray(addresses) && addresses.length > 0) {
          const ipv4 = addresses.find(a => a.family === 4);
          return res(ipv4 ? ipv4.address : addresses[0].address);
        }
        res(this.host);
      });
    });

    const attempt = (allowInsecure) => new Promise((resolve, reject) => {
      let isResolved = false;
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.disconnect();
          reject(new Error(`MQTT TLS 连接超时 (${timeoutMs}ms)`));
        }
      }, timeoutMs);

      try {
        const tlsOptions = {
          host: targetIp,
          port: this.port,
        };
        if (net.isIP(this.host) === 0) tlsOptions.servername = this.host;
        if (allowInsecure) tlsOptions.rejectUnauthorized = false;

        const socket = tls.connect(tlsOptions, () => {
          if (this.socket !== socket) return;
          // TLS 链路建立成功，立即发送 MQTT 3.1.1 CONNECT 报文
          const connectPacket = buildMqttConnectPacket(
            this.clientId,
            this.username,
            this.password,
            this.keepAliveSeconds
          );
          socket.write(connectPacket);
        });
        this.socket = socket;

        let recvBuf = Buffer.alloc(0);

        socket.on('data', (chunk) => {
          if (this.socket !== socket) return;
          recvBuf = Buffer.concat([recvBuf, chunk]);

          // 处理 CONNACK (0x20, 0x02, [flags], [returnCode])
          if (!this.isConnected && recvBuf.length >= 4) {
            if (recvBuf[0] === 0x20 && recvBuf[1] === 0x02) {
              const returnCode = recvBuf[3];
              recvBuf = recvBuf.subarray(4);

              if (returnCode === 0) {
                this.isConnected = true;
                clearTimeout(timeout);
                if (!isResolved) {
                  isResolved = true;
                  this.startPingLoop();
                  resolve({ success: true, message: 'MQTT 3.1.1 over TLS 握手成功' });
                }
              } else {
                const errCodes = {
                  1: '协议版本不受支持',
                  2: '客户端标识符被拒绝',
                  3: '服务不可用',
                  4: '用户名或密码格式错误',
                  5: '未授权连接'
                };
                const errReason = errCodes[returnCode] || `错误代码 ${returnCode}`;
                if (!isResolved) {
                  isResolved = true;
                  clearTimeout(timeout);
                  reject(new Error(`MQTT 认证被拒绝: ${errReason}`));
                }
              }
            }
          }

          // 处理 PINGRESP (0xD0, 0x00)
          while (recvBuf.length >= 2) {
            if (recvBuf[0] === 0xD0 && recvBuf[1] === 0x00) {
              this.lastPongTime = Date.now();
              recvBuf = recvBuf.subarray(2);
            } else {
              break;
            }
          }
        });

        socket.on('error', (err) => {
          clearTimeout(timeout);
          if (!isResolved) {
            isResolved = true;
            reject(err);
          }
          if (this.socket === socket) this.isConnected = false;
        });

        socket.on('close', () => {
          if (this.socket !== socket) return;
          this.isConnected = false;
          if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
          }
          if (!this.isClosedManually) {
            this.onLog('MQTT', 'MQTT 连接已断开', 'info');
          }
        });

      } catch (err) {
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(err);
        }
      }
    });

    try {
      return await attempt(false);
    } catch (error) {
      const certCode = mqttCertChainError(error);
      if (!this.allowInsecure || this.isClosedManually || !certCode) throw error;
      this.onLog('MQTT', `TLS 严格校验失败（host=${this.host}:${this.port}, code=${certCode}）；已按显式 allowInsecure 设置受控降级重试一次`, 'warning');
      this.disconnect();
      this.isClosedManually = false;
      return attempt(true);
    }
  }

  /**
   * 启动定期 PINGREQ 保持心跳循环
   */
  startPingLoop() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const intervalMs = Math.max(10, Math.floor(this.keepAliveSeconds * 0.75)) * 1000;

    this.pingTimer = setInterval(() => {
      if (this.isConnected && this.socket && !this.socket.destroyed) {
        try {
          this.lastPingTime = Date.now();
          this.socket.write(buildMqttPingReqPacket());
        } catch (e) {}
      }
    }, intervalMs);
  }

  /**
   * 发送一次即时 PINGREQ 并等待响应
   */
  async pingOnce() {
    if (!this.isConnected || !this.socket || this.socket.destroyed) {
      throw new Error('MQTT 客户端未连接');
    }
    this.lastPingTime = Date.now();
    this.socket.write(buildMqttPingReqPacket());
    return { success: true };
  }

  /**
   * 优雅断开 MQTT 连接
   */
  disconnect() {
    this.isClosedManually = true;
    this.isConnected = false;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.socket) {
      try {
        if (!this.socket.destroyed) {
          this.socket.write(Buffer.from([0xE0, 0x00])); // DISCONNECT
        }
        this.socket.end();
        this.socket.destroy();
      } catch (e) {}
      this.socket = null;
    }
  }
}

module.exports = {
  MqttKeepAliveClient,
  buildMqttConnectPacket,
  buildMqttPingReqPacket
};
