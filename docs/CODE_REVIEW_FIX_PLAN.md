# `ctyun-dashboard` 代码审阅修复计划（AI 可执行版）

> **文档用途**：本文档面向后续执行修复的 AI 工程师或开发者，汇总了全仓代码审阅中已核实的 **安全漏洞（P0）**、**功能与稳定性 Bug（P1）** 以及 **性能、架构与工程化优化项（P2）**。  
> **执行方式**：按 Phase 1 → Phase 6 顺序逐项实施。每个条目均给出**精确文件与行号、根因分析、具体改动步骤、回归红线提示及验收方法**。

---

## 0. AI 执行总则与回归测试红线（必读）

### 0.1 执行纪律
1. **分阶段推进，不要一次性大改跨模块**：每完成一个 Phase（或一组紧密相关的条目），立即运行验证命令确认通过后再进入下一项。
2. **只改需求明确覆盖的逻辑**：不得顺手重构不相关代码，不得删除原有的重要业务注释（如协议取证注释、事故复盘说明）。
3. **验证命令**：
   ```bash
   # 核心语法 + 204 项结构/行为回归测试（必跑）
   npm test

   # 变异测试（验证测试闸门本身未被削弱，必跑）
   npm run test:mutation

   # 若修改了 app/ecloud_engine/*.py，检查 Python 语法（若有 Python 环境）
   python -m py_compile app/ecloud_engine/*.py
   ```
   > 注意：若本地无 Python 环境，`npm test` 会跳过侧车行为断言；提交或发布前务必在有 Python 3.12 + `requests` + `pycryptodome` 的环境（或 GitHub Actions CI）中完整运行一次 `npm test`。

### 0.2 绝对不可误破的回归红线（`tests/regression.test.js` 静态/行为锁）
本仓库的 [tests/regression.test.js](file:///c:/Repositories/ctyun-dashboard/tests/regression.test.js) 包含大量**源码正则断言与 AST/字符串切片校验**。修改相关文件时必须遵守以下约束（如需调整受测契约，必须同步审查并更新对应的回归断言与 [tests/mutation_check.js](file:///c:/Repositories/ctyun-dashboard/tests/mutation_check.js)）：

| 回归组 | 约束范围 | 关键红线内容（执行前必核对） |
| :--- | :--- | :--- |
| **组 1（暗线 A）** | `server.js`, `scheduler.js` | 禁止在挂机/保活执行闸门处直接读取 `acc.features.*`；必须统一走 `resolveTask()` / `taskGate()`，且 `sign -> autoSign` 映射保持一致。 |
| **组 3（暗线 C）** | `app/tasks/native_tasks.js` | **硬编码 `isCompleted: true` 的返回点必须恰好保持 3 处**；所有 `pendingVerify` 返回必须显式带 `isCompleted: false`。 |
| **组 5** | `app/tasks/scheduler.js` | `runAllAccounts` 必须用 `try/finally` 复位 `this.isRunning = false`；禁止出现双分支相同文案的死代码。 |
| **组 7 / 27 / 30** | `app/ydpc/*.js` | `app/ydpc/` 下**禁止新增未纳入红线扫描的文件**；严禁无条件写死 `rejectUnauthorized: false`（`{ ... rejectUnauthorized: false }` 会直接触发失败），只允许在严格校验先行 + 证书链错误码白名单命中后，经显式 `allowInsecure` 开关受控降级一次并打 warning 留证。 |
| **组 8** | `app/ydpc/cag_boot.js` | `zteCsapEncryptQueryValue()` 的返回值**必须保持把 `+` 替换为 `%2B`**。修复 `cs_getToken` 密码双重编码时，必须在 `tokenQuery` 拼接处跳过对 `password` 的二次 `encodeURIComponent`，不可破坏 `zteCsapEncryptQueryValue` 本身契约。 |
| **组 14 / 15** | `app/ecloud/*`, `app/ecloud_engine/*` | 三平台（天翼云 / 移动爱家 `ydpc` / 移动公众 `ecloud`）保活逻辑与日志流必须严格隔离，禁止跨平台 `require`。 |
| **组 16 / 22 / 31 / 34** | `app/static/app.js`, `app/ecloud/ecloud_client.js`, `app/ydpc/ydpc_client.js` | ① 卡片分支中严禁出现「已保活 / 保活成功 / 保证不被关机 / 已完成保活」等虚报文案；<br>② 移动公众开关区必须保有精确匹配正则的 `toggleFeature('${acc.id}', 'autoBoot', this.checked)`、`pill-autoboot-${acc.id}-${escapeHtml(iid)}`、`🛡️守护: ${d.autoBootEnabled !== false ? '开' : '关'}`，且不得引用 `_ydpcVendors`；<br>③ 移动爱家卡片的 `onclick="toggleVmFeature('${acc.id}', '${usid}', 'autoBootEnabled'...` 和 `onclick="bootYdpcVm('${acc.id}', '${usid}'...` 以及增量同步中的 `if (pAutoBoot) {` 与 `pAutoBoot.innerText = \`🛡️守护: ` 受静态正则保护；<br>④ 移动爱家/移动公众卡片分支注释头（`// 📱 移动云电脑专属卡片呈现`、`// ☁️ 天翼云电脑专属卡片呈现`、`分层自动化保活开关`）被 `indexOf` 切片依赖，不可删除或改名。 |
| **组 17** | `app/static/app.js` | `showEcloudSmsGroup(` 函数结构受静态切片检查。 |
| **组 23 / 24 / 25** | `app/ydpc/product_route.js`, `ydpc_client.js` | `product_route.js` 禁止出现 IP 字面量正则（`isIpv4Literal` 刻意手写字符判断）及网络/TLS 关键词；`keepaliveProven: false` 必须保持为字面量 `false`。 |
| **组 30** | `app/ydpc/scg_keepalive.js`, `tests/regression.test.js` | `cemBootVm` 中 `timeoutMs: 120000` 受静态正则检查；`tests/regression.test.js:4500,4504` 当前断言 `SP.ACK_SYNC === 0x0006`、`SP.PONG === 0x0005`（修复 SPICE 操作码需先结合真机抓包确认，并同步更新该测试断言）。 |
| **组 32** | `app/ydpc/ydpc_client.js` | 所有关机判定必须统一收敛到 `isYdpcVmOff(vm)`。 |
| **组 33** | `app/auth_manager.js`, `server.js`, `app/static/app.js` | `AuthManager` 构造恢复/落盘/销毁三件套及 `hashPassword` + `login` 行为受断言保护；前端登录 `localStorage`/`sessionStorage` 双存储分流与 `/api/auth/logout` 吊销逻辑受正则断言保护。 |
| **Scheduler 隔离** | `app/tasks/scheduler.js` | `platform !== 'ecloud'` 出现次数必须 `>= 5`，且包含固定检查表达式 `taskGate(acc, 'cloudHang') && acc.platform !== 'ydpc' && acc.platform !== 'ecloud'`、`autoRedeem && acc.platform !== 'ydpc' && acc.platform !== 'ecloud'`、`taskGate(acc, 'keepAlive', client)`。 |

---

## 全局任务追踪矩阵

| ID | 优先级 | 模块 | 任务简述 | 主要涉及文件 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `P0-01` | P0 | `server.js` | 未鉴权接口补齐鉴权与开放代理/缓存限制 | `server.js` | [x] |
| `P0-02` | P0 | `server.js` | 修复 SSRF 过滤绕过（IPv6 方括号/DNS 重绑定/302 跳转） | `server.js` | [x] |
| `P0-03` | P0 | `app/static`, `server.js` | 消除存储型 XSS、属性注入与服务端 HTML/Script 注入 | `app/static/app.js`, `server.js` | [x] |
| `P0-04` | P0 | `server.js`, `app/static` | API 响应剥离明文密码与会话密钥，编辑弹窗不再回填明文密码 | `server.js`, `app/static/app.js` | [x] |
| `P0-05` | P0 | `app/ydpc` | 关闭 `cag_boot.js` 默认 wireLog 凭据泄露；恢复 `mqtt_client.js` TLS 校验 | `app/ydpc/cag_boot.js`, `app/ydpc/mqtt_client.js` | [x] |
| `P0-06` | P0 | `app/static` | 移除第三方二维码外链，本地生成扫码登录二维码 | `app/static/app.js`, `server.js` | [x] |
| `P0-07` | P0 | `auth_manager.js`, `sidecar.py`, 全局 | `scrypt` 密码哈希升级、改密吊销会话、`0600` 落盘与安全随机数 | `app/auth_manager.js`, `app/ecloud_engine/sidecar.py`, `native_tasks.js`, `soho_client.js`, `server.js` | [x] |
| `P1-01` | P1 | `server.js` | 修复飞书通知未用剥离后 URL 与管理员测推送漏传 `secret` | `server.js` | [x] |
| `P1-02` | P1 | `server.js` | 修复 `checkExternalPowerOn` 强行覆写用户手动关闭的保活开关 | `server.js` | [ ] |
| `P1-03` | P1 | `server.js` | 修复 `refreshOfficialTasks` 40010 未重试及用积分结果掩盖任务读取失败 | `server.js` | [ ] |
| `P1-04` | P1 | `server.js` | 修复 12h 续期风暴、`stopKeepAliveWorker` 定时器泄漏与打卡倒计时误清零 | `server.js` | [ ] |
| `P1-05` | P1 | `app/tasks` | 修复 `TaskScheduler` 多平台串扰、重复触发、`NaN` 死循环与无超时下单 | `app/tasks/scheduler.js`, `app/tasks/native_tasks.js` | [ ] |
| `P1-06` | P1 | `server.js`, `auth_manager.js`, `ctyun_encryption.js` | 路由异常兜底、请求体限制、侧车进程清理、平台守卫、配额 `0` 修复 | `server.js`, `app/auth_manager.js`, `app/ctyun_encryption.js` | [ ] |
| `P1-07` | P1 | `ydpc_client.js` | 修复 `verifyKeepAliveEffect` 必现 `ReferenceError: originCn is not defined` | `app/ydpc/ydpc_client.js` | [ ] |
| `P1-08` | P1 | `ydpc_client.js` | 修复底座探测缓存失效、键类型不匹配、闭包陈旧 `vm`、数据面死循环与 MQTT 关闭失效 | `app/ydpc/ydpc_client.js` | [ ] |
| `P1-09` | P1 | `cag_boot.js` | 修复 `cs_getToken` 密码双重 URL 编码与 HTTP/解密/重试边缘 Bug | `app/ydpc/cag_boot.js` | [ ] |
| `P1-10` | P1 | `scg_keepalive.js` | 修复 `waitMainInit` 100% CPU 死循环、10s 空等、waiter 泄漏、BigInt 截断与认证失败续跑 | `app/ydpc/scg_keepalive.js`, `tests/regression.test.js` | [ ] |
| `P1-11` | P1 | `zte_cag_tls.js` | 修复子通道缓冲 OOM、47.6ms 超时导致流错位与 `upgradeToTls` 永久挂起 | `app/ydpc/zte_cag_tls.js` | [ ] |
| `P1-12` | P1 | `soho_client.js`, `mqtt_client.js`, `cag_client.js`, `zte_cag_raw.js`, `product_route.js` | 修复 `login` 递归死循环、MQTT `recvBuf` 阻塞与死链检测、CAG 假成功、错误分级误判 | `app/ydpc/*.js` | [ ] |
| `P1-13` | P1 | `ecloud_engine` | 修复多进程覆写共享 `sessions.json`/`login_rate_limit.json` 与 `.tmp` 竞态及 `loginUid` 持久化 | `app/ecloud_engine/sidecar.py`, `login_rate_limit.py`, `ecloud_client.js` | [ ] |
| `P1-14` | P1 | `ecloud_engine.js`, `sidecar.py` | 修复 Windows UTF-8/GBK 崩溃、未监听 `stdin` EPIPE、Python 探测截断及旧子进程误杀新实例 | `app/ecloud/ecloud_engine.js`, `app/ecloud_engine/sidecar.py` | [ ] |
| `P1-15` | P1 | `ecloud_client.js` | 修复 `autoBootEnabled` 每 10 分钟丢失、重启未恢复会话、主动续期双缺陷与定时复活 | `app/ecloud/ecloud_client.js` | [ ] |
| `P1-16` | P1 | `ecloud_engine/*.py` | 修复 `RequestException` 破坏三态、90s RPC 超时、`normalize_power_state` 误判、空 Token 登录与 FD 泄漏 | `app/ecloud_engine/*.py` | [ ] |
| `P1-17` | P1 | `app/static/app.js` | 激活死代码 `updateAccountsInPlace` 并修复结构指纹与过时 `onclick` 状态 | `app/static/app.js` | [ ] |
| `P1-18` | P1 | `app/static/app.js` | 修复拖拽排序落手即失效（`drop` 早于 `dragend` 清零状态） | `app/static/app.js` | [ ] |
| `P1-19` | P1 | `app/static` | 实现 `onProductSelectChange()` 消除自动兑换下拉框 `ReferenceError` | `app/static/app.js`, `app/static/index.html` | [ ] |
| `P1-20` | P1 | `app/static` | 修复纯 ZTE `autoBoot` 误开启、设置保存覆写周期、定时器/SSE 泄漏、配额 `0` 及 CSS 主题 Bug | `app/static/app.js`, `app/static/style.css` | [ ] |
| `P2-01` | P2 | `server.js`, `ecloud_client.js` | 降频同步写盘与天翼云上游轮询频率 | `app/ecloud/ecloud_client.js`, `server.js` | [ ] |
| `P2-02` | P2 | `app/static/app.js` | 后台/未登录暂停轮询；优化 SSE 重连、日志索引、防抖与 `DocumentFragment` 渲染 | `app/static/app.js`, `app/static/style.css` | [ ] |
| `P2-03` | P2 | `ydpc`, `ecloud_engine`, `static` | 抽取共享 TLS 策略与时长耗尽判断；清理死代码与未用资源 | 多文件 | [ ] |
| `P2-04` | P2 | `server.js`, `app.js` | 单体文件渐进式模块化拆分蓝图 | `server.js`, `app/static/app.js` | [ ] |
| `P2-05` | P2 | CI / Docker / Tests | 修复失效 `package.json` 脚本、补全语法检查清单、加固 Docker/CI 并增补回归测试 | `package.json`, `tests/*`, `Dockerfile`, `.github/workflows/docker-build.yml` | [ ] |

---

## Phase 1：P0 安全加固（Security Hardening）

> **优先级**：最高。所有直接暴露未鉴权控制面、SSRF 绕过、存储型 XSS 及明文凭据外泄必须在此阶段修复。

### [P0-01] 未鉴权接口补齐鉴权与开放代理/缓存收敛
- **位置**：
  - `server.js:6530-6538`（`POST /api/keeper/restart`）
  - `server.js:3742-3816`（`/api/ctyun-proxy`）
  - `server.js:3416, 3442-3489, 3718-3739`（`/workers/`、`bbEncDecoder`/`*.wasm`、`/ctyun-static/` 及 `ctyunStaticCache`）
  - `server.js:5273-5276`（`POST /api/device/generate`）
- **根因**：
  1. `/api/keeper/restart` 无任何 `getSessionFromReq` 或管理员校验，匿名请求可随时重置全站保活进程。
  2. `/api/ctyun-proxy` 未鉴权，将任意方法、任意大小请求体转发至任意 `*.ctyun.cn` 主机且禁用证书校验。
  3. 静态代理无鉴权且 `ctyunStaticCache` 无总容量与条目数上限（单条 <20MB 即写入，512MB 容器内存可被恶意路径耗尽触发 OOM）。
  4. `/api/device/generate` 未登录即可调用。
- **修改步骤**：
  1. 在 `POST /api/keeper/restart`（`server.js:6530`）开头校验 `const session = getSessionFromReq(req);`，未登录返回 `401`，`session.role !== 'admin'` 返回 `403`。
  2. 在 `/api/ctyun-proxy`（`server.js:3742`）处理非 `OPTIONS` 请求前校验 `const session = getSessionFromReq(req, parsedUrl);`（`/desktop-view` 注入页面如改用 Cookie 或透传 token 需保证浏览器请求携带鉴权）。若未登录返回 `401`。同时：
     - 校验 `parsedTarget.protocol === 'https:'`、`!parsedTarget.username && !parsedTarget.password`，且仅允许精确白名单主机或 `hostname === 'ctyun.cn' || hostname.endsWith('.ctyun.cn')`。
     - 限制 `bodyChunks` 总字节数（例如 `10 * 1024 * 1024`），超限直接返回 `413` 并销毁流；监听 `req.on('error', ...)`；去掉对代理请求的盲目 `rejectUnauthorized: false`（仅保留默认严格 TLS，除非确认天翼云特定端口存在自签证书）。
  3. 改造 `ctyunStaticCache` 为带上限的 LRU（如最大条目 `64`、总内存上限 `32 * 1024 * 1024`，单文件上限 `8 * 1024 * 1024`），超限时循环淘汰最早键；在 `proxyStaticAsset` 对 `targetUrl` 校验 `https:` 且主机严格为 `pc.ctyun.cn`，并对 `relPath`/`filename` 禁止 `..` 与非预期字符；在 `/workers/`、`/ctyun-static/`、`/static/` 回源路径核对（若桌面代理页面已登录，可一并校验 `session` 或 Referer/Cookie，注意不得破坏公开登录首页 `/` 所需的 `/static/*` 本地资源）。
  4. 为 `POST /api/device/generate` 补充登录态校验（`if (!session) return 401`），注意确认前端仅在登录后新增/编辑账号弹窗中调用它。
- **验收**：未登录 `curl -X POST http://127.0.0.1:8571/api/keeper/restart`、`curl "http://127.0.0.1:8571/api/ctyun-proxy?target=https://pc.ctyun.cn/"` 返回 `401`；普通用户调用 `/api/keeper/restart` 返回 `403`。
- **执行记录（2026-11-24）**：已完成鉴权、桌面页 Cookie 透传、HTTPS/请求体/静态路径限制及有界 LRU；新增 4 项隔离行为回归、2 项变异。Windows + 独立 Python 3.12.10（requests / pycryptodome）回归：208 通过、0 失败；已做只读 review。全阶段变异测试于 P0-07 完成后统一运行。

---

### [P0-02] 修复 SSRF 过滤绕过（IPv6 方括号 / DNS 重绑定 / 302 重定向）
- **位置**：`server.js:487-547`（`isPrivateIpOrHost`、`isValidWebhookTarget`）及 `server.js:557-759`（`sendNotification`）
- **根因**：
  1. `new URL('http://[::1]:8571/').hostname` 返回 `"[::1]"`（含方括号），而 `isPrivateIpOrHost` 未去括号，`net.isIPv6('[::1]')` 为 `false`，导致 `[::1]`、`[::ffff:127.0.0.1]`、`[::ffff:169.254.169.254]`、`[fe80::1]` 全部绕过校验。
  2. IPv4 段未封禁 CGNAT `100.64.0.0/10`、`224.0.0.0/4`（组播）及 IPv4-mapped IPv6 十六进制形式（`::ffff:7f00:1`）。
  3. 仅检查字面量主机名，未对域名执行 DNS 解析后复检（可通过公网域名解析到 `127.0.0.1`/`169.254.169.254` 绕过）。
  4. `sendNotification` 中所有 `fetch()` 均未禁重定向（`redirect: 'error'`），可通过 302 跳转至内网服务，且未带超时保护。
  5. `server.js:535` 仅剥离 `@SEC`，但飞书支持 `url@secret`（`server.js:681`），若飞书用户填写 `@secret` 且含特殊字符可能影响 URL 解析。
- **修改步骤**：
  1. 重构 `isPrivateIpOrHost(hostname)`：
     - 剥离首尾方括号及 IPv6 Zone ID：`const h = String(hostname || '').toLowerCase().trim().replace(/^\[|\]$/g, '').split('%')[0];`。
     - IPv4 校验补全 `100.64.0.0/10`（`parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127`）与 `>= 224` 保留/组播段。
     - IPv6 校验处理 `::ffff:a.b.c.d`（递归提取尾部 IPv4 走 IPv4 检查）及 `::ffff:xxxx:yyyy`（转换为 4 段字节走 IPv4 检查）；屏蔽 `::`、`::1`、`fe80::/10`（`/^fe[89ab][0-9a-f]:/`）、`fc00::/7`（`/^f[cd][0-9a-f]{2}:/`）、`ff00::/8`。
  2. 在 `isValidWebhookTarget(channel, rawTarget)` 中对飞书渠道同步支持剥离 `@secret` 后再校验 URL；禁止 URL 含 `username`/`password`。
  3. 新增 `async function assertSafePublicUrl(rawUrl)`：调用 `await dns.promises.lookup(hostname, { all: true })`（若非 IP 字面量），若解析为空或任一返回 IP 命中 `isPrivateIpOrHost(addr.address)` 则抛出拦截异常。
  4. 在 `sendNotification` 真正发请求前对目标 URL 调用 `await assertSafePublicUrl(...)`，并将所有裸 `fetch(...)` 统一改为 `fetchWithTimeout(url, { ..., redirect: 'error' }, 15000)`。
- **验收**：对 `http://[::1]:8571/`、`http://[::ffff:127.0.0.1]/`、`http://[::ffff:7f00:1]/`、`http://169.254.169.254/`、`http://100.64.0.1/` 调用 `isValidWebhookTarget('webhook', url)` 全部返回 `false`。
- **执行记录（2026-11-24）**：已补齐 IPv4/IPv6 私网与保留地址校验、DNS 全结果校验及连接地址固定；全部通知渠道经统一安全入口，禁止重定向并限制 15 秒请求预算，飞书路径签名后缀在校验和发请求时一致剥离。新增 3 项回归、3 项变异；完整回归 211 通过、0 失败，已做只读 review。

---

### [P0-03] 彻底消除存储型 XSS 与服务端 HTML/Script 注入
- **位置**：
  - `app/static/app.js:4758-4761`（`escapeHtml`）
  - `app/static/app.js:5032-5033`（管理员用户管理表 inline `onclick`）
  - `app/static/app.js:702-704, 744-748, 1123, 1183, 1337-1366, 1423, 1595-1623, 1671, 1816, 1828, 4034, 4575, 5040`
  - `server.js:3368-3373, 3585-3587, 3699, 3712`
- **根因**：
  1. `app.js:5032-5033` 将用户可控的 `u.username` 与 `u.id` 未经任何转义直接拼入 `onclick="openAdminSetPwdModal('${u.id}', '${u.username}')"`，开启自助注册后可导致管理员接管漏洞。
  2. `escapeHtml()` 未处理非字符串与单引号 `'`，且多处服务端来源字段（任务名、周期文案、`usid`、`vm.remainText`、`targetId`、`useStatusText`、日志来源、错误消息）未经过 `escapeHtml()` 直接进入 `innerHTML`。
  3. `server.js` 在拼接 `index.html` 标题/副标题、`/desktop-view` 账号名/错误提示及内联 `<script>` 中的 `authDataObj` 时均未转义，`</script>` 或 `<img ...>` 可闭合脚本块/注入 DOM；`String.prototype.replace` 替换字符串含 `$&` 等特殊模式时也会被解释。
- **修改步骤**：
  1. **升级 `app.js` 的 `escapeHtml()`**：
     ```js
     function escapeHtml(str) {
       return String(str ?? '')
         .replace(/&/g, '&amp;')
         .replace(/</g, '&lt;')
         .replace(/>/g, '&gt;')
         .replace(/"/g, '&quot;')
         .replace(/'/g, '&#39;');
     }
     ```
  2. **清理管理员表（`app.js:5032-5033`）与卡片中的非受限内联 `onclick`**：
     - 用户管理表：按钮改为 `class="btn btn-sm js-admin-set-pwd" data-user-id="${escapeHtml(u.id)}" data-username="${escapeHtml(u.username)}"` 及 `js-admin-del-user`，在 `tbody` 上挂载单一事件委托监听，通过 `btn.dataset.userId` 和 `btn.dataset.username` 调用 `openAdminSetPwdModal` / `deleteUserAccount`。
     - 同样把 `app.js:1123`（`powerEcloudDesktop` 带 `d.machineName`）、`app.js:1366`（`rebootYdpcVm` 带 `vm.vmName`）等带自由文本名称的按钮改为 `data-*` 属性 + 委托调用。
     - ⚠️ **回归约束注意**：`toggleVmFeature('${acc.id}', '${usid}', 'autoBootEnabled'...)` 与 `bootYdpcVm('${acc.id}', '${usid}'...)` 被 `tests/regression.test.js:4792,4796` 静态正则检查；`toggleFeature('${acc.id}', 'autoBoot', ...)` 被 `tests/regression.test.js:2129,2160` 静态正则检查。**对这三处不可删改函数签名格式**，但必须确保后端生成和渲染阶段 `acc.id` 与 `usid`/`iid` 仅含安全字符（或额外封装转义校验，且在模板中保留正则要求形态）。
  3. **全量补齐 `innerHTML` 转义**：对 `app.js:702-704`（`t.name`、`t.points`）、`744-748`（`rawName`）、`1183, 1423, 1671, 1816, 1828`、`1337-1366`（`usid`、`specSuffix`、`vm.remainText`）、`1595-1623`（`targetId`）、`4034`（`st`）、`4575`（`item.timestamp`、`item.source`）、`5040`（`e.message`）全部包上 `escapeHtml(...)`（或使用 `textContent` 赋值）。
  4. **服务端 HTML/JS 转义（`server.js`）**：
     - 新增 `escapeHtmlServer(str)` 与 `safeJsonForScript(obj)`（`JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')`）。
     - `server.js:3370-3372` 使用 `() => ...` 回调函数替换，并对 `currentTitle`/`currentSubtitle` 调用 `escapeHtmlServer()`。
     - `server.js:3585-3587` 改为 `safeJsonForScript(...)`，`3699` 和 `3712` 对 `acc.name || acc.user`、`err.message` 调用 `escapeHtmlServer()`。
- **验收**：注册用户名 `"><img src=x onerror=alert(1)>'` 后在管理员视图打开用户管理弹窗，不弹窗、DOM 正常文本展示且修改密码/删除按钮功能正常。
- **执行记录（2026-11-24）**：完成 HTML/属性/内联 JS/Script JSON 分上下文转义，管理按钮和移动公众开机改为 data 属性委托；移动公众原 inline 接线断言同步为委托接线并新增行为验证，移动爱家受保护调用格式保留、名称由 dataset 传入。非法账号/受保护回调主机标识只读展示，配置标识不改写。新增 4 项攻击载荷回归、4 项变异；完整回归 215 通过、0 失败，已做只读 review。浏览器真机验收不计作已执行。

---

### [P0-04] API 响应剥离明文密码与内部凭据
- **位置**：
  - `server.js:4242-4306`（`GET /api/accounts`）
  - `server.js:4475, 4549, 4619, 4792, 4890, 4983`（各写接口返回账号对象）
  - `app/static/app.js:547, 3170, 3195, 3220`（`editAccount` 与保存逻辑）
- **根因**：`GET /api/accounts` 及更新接口使用 `{ ...acc }` 将明文 `acc.password`、`acc.savedLoginInfo`（含 `secretKey` / `token`）与 `_smsCodeKey` 直接下发前端；`editAccount()` 将明文密码直接填进弹窗 `<input>`。
- **修改步骤**：
  1. 在 `server.js` 新增 `sanitizeAccountForClient(acc)`：
     ```js
     function sanitizeAccountForClient(acc) {
       if (!acc || typeof acc !== 'object') return acc;
       const { password, savedLoginInfo, _smsCodeKey, ...rest } = acc;
       return { ...rest, hasPassword: Boolean(password) };
     }
     ```
  2. 对 `GET /api/accounts` 返回数组的每一项（`server.js:4256, 4279, 4298`）及 `POST /api/accounts`、`POST /api/accounts/ydpc/add`、`POST /api/accounts/ecloud/add`、`POST /api/accounts/ecloud/login`、`PUT /api/accounts/:id`、`PUT /api/accounts/:id/vm-feature` 返回体中的 `account` 字段全部包一层 `sanitizeAccountForClient(...)`。
     > ⚠️ 注意：`GET /api/config/export`（`server.js:6267`）是用户显式备份导出接口，按原有设计保留备份完整性；但切勿在普通状态轮询 `GET /api/accounts` 返回密码。
  3. 前端 `app/static/app.js` 的 `editAccount()`（`:3170, :3195, :3220`）在编辑模式下将 `#ecloud-password`、`#ydpc-password`、`#acc-password` 置空，设置 `placeholder = acc.hasPassword ? "已配置密码（留空则保持不变）" : "请输入登录密码"`；保存函数（`saveAccount`、`saveYdpcAccount`、`saveEcloudAccount`）在编辑态若密码框为空，则**不**要求必填（对于只改备注/周期的编辑场景，如后端已存密码则不覆盖；仅当用户输入新密码时才随请求下发）。
  4. 检查 `app.js` 是否有地方读取 `acc.password`：搜索确认仅 `editAccount` 与表单保存读取，若展示逻辑有判定“是否账密登录”，改读 `acc.hasPassword`（或兼容 `acc.hasPassword || Boolean(acc.password)`）。
- **验收**：打开浏览器 Network 面板查看 `/api/accounts` 响应，JSON 中不再出现 `password` 或 `savedLoginInfo` 字段；编辑账号不改密码直接保存仍可正常保活。
- **执行记录（2026-11-24）**：列表、账号写接口、单机开关和扫码授权返回均经统一账号脱敏，剥离 password / savedLoginInfo / _smsCodeKey 并提供 hasPassword；原配置与显式备份导出分支保留。三平台编辑清空密码，留空不发送密码字段，新输入正常提交，新增仍要求密码。新增 3 项回归、3 项变异；完整回归 218 通过、0 失败，已做只读 review。

---

### [P0-05] 关闭 `cag_boot.js` 默认 wireLog 凭据泄露 + 恢复 `mqtt_client.js` TLS 校验
- **位置**：
  - `app/ydpc/cag_boot.js:177-204, 725-728, 772, 780, 849, 953, 981, 1013, 1068, 1130`
  - `app/ydpc/mqtt_client.js:115-120`
- **根因**：
  1. `cag_boot.js:849` 默认 `wireLog = true`（且 `ydpc_client.js:626` 未传 `false`），每次启动都把含 `password=`（用仓库已知静态密钥 `ZTE_CSAP_ID` AES-128-ECB 加密，可瞬间还原明文）、`accessToken=` 的 URL，以及含 `ZTE_Security_Params` / `connectStr` 的 JSON 字符串写入日志；且 `redactForLog()`（L197）遇到字符串参数直接原样返回，脱敏完全失效。
  2. `mqtt_client.js:119` 无条件写死 `rejectUnauthorized: false`，并将 IP 地址直接传入 `servername`（违反 SNI 规则，触发 Node `DEP0123`）。
- **修改步骤**：
  1. **`cag_boot.js` 脱敏与默认静默**：
     - L849 将 `const wireLog = opts.wireLog !== false;` 改为 `const wireLog = opts.wireLog === true;`（默认关闭，仅排障显式开启）。
     - 修复 `redactForLog(value)`：当 `typeof value === 'string'` 时，尝试 `JSON.parse(value)`；若解析成功则按对象递归脱敏后再序列化，且在敏感字段名列表中加入 `ZTE_Security_Params`、`connectStr`、`vmPassword`、`password`、`accessToken`、`token`；若非 JSON 字符串则用正则对 `password=...`、`accessToken=...`、`token=...` query 参数脱敏。
     - L726、L780 打印 `pathWithQuery` 前先经 `redactQueryString(pathWithQuery)` 处理，严禁把 `password` 和 `accessToken` 写入任何日志。
  2. **`mqtt_client.js` TLS 证书校验**：
     - ⚠️ 遵守回归组 7 红线：严禁在 `app/ydpc/` 出现无条件 `rejectUnauthorized: false` 字面量！
     - 参照 `cag_boot.js` / `scg_keepalive.js` 模式：构造 `tlsOptions` 时当 `net.isIP(this.host) === 0` 才设置 `servername: this.host`；默认走严格证书校验（不设置 `rejectUnauthorized`）；若连接抛出证书链白名单错误（`CERT_HAS_EXPIRED`、`DEPTH_ZERO_SELF_SIGNED_CERT`、`SELF_SIGNED_CERT_IN_CHAIN`、`UNABLE_TO_VERIFY_LEAF_SIGNATURE`、`ERR_TLS_CERT_ALTNAME_INVALID` 等），记录一条包含 host 与错误码的 `warning` 日志后，通过显式 `allowInsecure` 参数重试一次（仅在 `if (allowInsecure) options.rejectUnauthorized = false;` 分支设置）；非证书链错误直接失败，不降级。
- **验收**：运行 `npm test` 组 7 扫描通过；触发移动爱家开机时日志中不再出现明文或静态可逆 `password=` / `accessToken=`；MQTT 连接 IP Broker 不再触发 `DEP0123`。
- **执行记录（2026-11-24）**：wireLog 默认关闭，对对象/JSON 字符串/query/截断 JSON 脱敏，安全 warning 保留独立通道。MQTT 默认严格 TLS，IP 不设置 SNI，构造参数 allowInsecure 必须显式为 true 且命中证书错误白名单才重试一次；旧连接事件不影响重试连接。MQTT 纳入红线与语法扫描。新增 3 项回归、4 项变异；221 通过、0 失败，15 个文件语法通过，已做只读 review；真实 Broker/开机日志尚未实测。

---

### [P0-06] 消除扫码 URL 外泄第三方服务
- **位置**：`app/static/app.js:2631`（`loadQrCodeForModal`）及 `server.js:5100-5121`
- **根因**：`app.js:2631` 将官方授权链接 `data.qrUrl` 传给第三方 `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=...`，既向外部服务泄漏实时扫码登录地址，又导致纯内网/无外网 Docker 环境扫码登录图片永远加载失败（且无 `onerror` 处理）。
- **修改步骤**：
  1. 实现零外部依赖本地二维码生成（二选一，推荐方案 A 零新增前端库依赖或极简内置）：
     - **方案 A（纯 Node/内置轻量 JS QR 生成器）**：在 `app/static/` 或 `app/utils/` 放入轻量、无依赖、MIT 协议的标准 QR Code 生成模块（或精简 SVG/Canvas 编码函数），前端直接由 `data.qrUrl` 在本地生成 `data:image/svg+xml;base64,...` 或 `<canvas>` 展示；或由服务端 `/api/account/qrcode/generate` 同时返回本地生成的 SVG Data URI `qrImageDataUrl`。
  2. 在 `app.js:2631` 优先渲染本地 `qrImageDataUrl`（或本地前端渲染函数），彻底删除 `https://api.qrserver.com/...` 外链。
  3. 为 `#acc-qrcode-img` 绑定 `onerror` 回调：加载失败时隐藏骨架屏并展示可复制链接/重试按钮，避免骨架屏永久转圈。
- **验收**：断网或阻断外网 `api.qrserver.com` 情况下，天翼云扫码登录弹窗可正常瞬间渲染出可扫描的二维码图片。
- **执行记录（2026-11-24）**：服务端内置 MIT 许可 QR Model 2 字节编码模块，M 级纠错、1–40 版本，返回本地 SVG Data URI；前端移除第三方图片地址，图片失败停止骨架并显示复制链接/重试，保留 API 失败诊断。7 组矩阵匹配独立 Project Nayuki 参考（含 UTF-8、Version 32、最大容量），无新增运行时依赖。新增 2 项回归、2 项变异；223 通过、0 失败，16 个文件语法通过，已做只读 review。真实手机扫码仍未实测；官方授权链接获取仍需要官方网络。

---

### [P0-07] 认证会话与密钥存储加固
- **位置**：
  - `app/auth_manager.js:3-5, 66-130, 250-257`
  - `app/ecloud_engine/sidecar.py:144-161, 227, 233-240, 294, 328, 359, 368`
  - `app/tasks/native_tasks.js:222, 284`、`app/ydpc/soho_client.js:53-69`、`server.js:479-484`
- **根因**：
  1. `auth_manager.js` 使用固定全局盐 `ctyun_salt_2026` 做单次 `SHA-256`；且修改密码后未吊销旧会话；内存中过期会话若未被查询过会长期滞留 `this.sessions`。
  2. `sidecar.py` 持久化 `sessions.json` 时使用 `Path.write_text()`，在 Linux/Docker 下默认权限 `0644`（同机其他用户可读 Bearer Token）；内存中保留明文 `password`，且 IPC 返回了前端/Node 从未使用的裸 `accessToken`。
  3. 多处安全随机串（AI 对话 AES `clientKey`、`Web-Random`、`genUuid`、`generateDeviceCode`）使用 `Math.random()`。
- **修改步骤**：
  1. **`auth_manager.js` 密码哈希平滑升级 + 改密吊销**：
     - 升级 `hashPassword(password, salt)`：若未传 `salt`（或为默认），生成 `16` 字节随机盐并用 `crypto.scryptSync(password, randomSalt, 64).toString('hex')` 返回 `scrypt$${saltHex}$${hashHex}`。
     - 新增 `verifyPassword(password, storedHash)`：若 `storedHash` 以 `scrypt$` 开头，拆出 `saltHex` 与 `hashHex` 计算 `scryptSync` 并用 `crypto.timingSafeEqual` 比对；否则兼容旧版 `sha256(password + 'ctyun_salt_2026')`（`timingSafeEqual`），并在 `login()` 成功时静默自动升级写回 `scrypt$` 哈希。
     - ⚠️ 确认兼容 `tests/regression.test.js:1989-2000`：`hashPassword('admin123')` 写入 `passwordHash` 后立即调用 `a1.login('admin', 'admin123', true)` 必须返回 `success: true`。
     - `updateUserPassword(userId, newPassword)` 清理该用户的所有既有会话（并调用 `_persistSessions()`）；可在路由层为“本人修改密码”按需保留当前 token 或令前端重新登录，管理员重置他人密码必须吊销目标用户全部会话。
     - 在 `createSession()` 或定期任务中惰性清理 `this.sessions` 中已过期的条目。
  2. **`sidecar.py` 最小权限与内存清理**：
     - `_persist_sessions()` 写 `.tmp` 文件时改用 `os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)` + `os.fdopen(..., 'w', encoding='utf-8')`（并在 `os.replace` 前于 POSIX 下 `os.chmod(..., 0o600)`）。
     - `op_login_begin` / `op_login_sms` / `op_session_relogin` 一旦登录达到 `LoginResult.SUCCESS`，立即执行 `s["password"] = ""`（`NEED_TWO_FACTOR` 需待短信完成再清空）。
     - `op_login_begin`、`op_login_sms`、`op_session_restore`、`op_session_relogin` 的返回字典移除无用裸 `accessToken` 字段（检查确认 `ecloud_client.js` 与 `regression.test.js` 无读取该返回字段）。
  3. **替换 `Math.random()`**：
     - `native_tasks.js:222, 284` 改用 `crypto.randomBytes` + `crypto.randomInt` 生成 `clientKey` 与 `rnd`；
     - `soho_client.js:53-69` 的 `genUuid()` 改用 `'uuid_' + crypto.randomUUID().replace(/-/g, '').toUpperCase()`，`genDeviceId()` 使用 `crypto.randomBytes(6)`；
     - `server.js:479-484` 的 `generateDeviceCode()` 使用 `crypto.randomBytes` / `crypto.randomInt`。
  4. **Token 存储与 URL Token 演进说明（需注意回归组 33）**：
     - 当前 `tests/regression.test.js:2046-2057` 强校验前端 `localStorage.setItem("ctyun_auth_token", ...)` 与 `sessionStorage` 逻辑。完成本阶段 XSS 修复（`P0-03`）后窃取风险已大幅降低；如后续决定彻底消除前端 JS 可读 Token，须另立子任务把登录接口改为下发 `HttpOnly; SameSite=Lax` Cookie、为 `/desktop-view` 和 `/api/logs/stream` 改为短时效（如 30s）一次性 ticket，并同步重写回归测试组 33。

- **执行记录（2026-11-24）**：已完成随机盐 scrypt 与常量时间验证、旧 SHA-256 正确登录后平滑迁移、改密吊销目标全部会话及过期惰清。会话吊销无法落盘时不改密并恢复原会话；密码配置保存失败如实返回未完成，不假报成功。本人改密/管理员重置本人后重新登录，重置别人不退出管理员自身会话；保留组 33 的恢复/落盘/销毁和 localStorage/sessionStorage 分流。桌面专用 Cookie 仅用于桌面页及资源，普通 API 保持原有显式凭据优先级。侧车成功登录后清空密码、四个 IPC 返回不再携带未使用的裸 Token，私密文件以 0600 创建并在写入/替换前收紧权限；安全随机串保持原 AES key、Web-Random、UUID、MAC 与设备号协议形状。新增 11 项回归、32 项变异，AuthManager/SOHO 已纳入语法检查；完成本项代码及直接依赖的只读 review。
- **Phase 1 最终验证**：在 Windows + 隔离 Python 3.12.10（requests / pycryptodome）环境执行，原始 204 项回归保留，侧车行为断言没有跳过。

  | 实际 npm 脚本 / 检查 | 退出码 | 实际结果 | 本机证据 |
  | :--- | :---: | :--- | :--- |
  | `npm test` | 0 | 18 个 JS 文件语法通过；234 项回归通过、0 失败、0 跳过 | [最终回归日志](../backups/phase1-20261124.tmp/verification/test-final-2.log) |
  | `npm run test:mutation` | 0 | 171 项全部捕获，0 漏网、0 BROKEN、0 跳过；末尾原仓库基线 234 通过、0 失败（exit=0） | [完整变异日志](../backups/phase1-20261124.tmp/verification/mutation-final-2.log) |
  | Python `py_compile`（逐一编译 `app/ecloud_engine/*.py`，pyc 定向到本次临时目录） | 0 | 9 个 Python 文件语法通过 | 本次执行输出：`Python syntax: 9 files passed` |

  为遵守禁止物理删除，上述两个 npm 脚本由本次专用运行器调用（未修改 `package.json`），测试清理转换为可恢复移动。实际入口分别为 `pwsh -NoProfile -File backups/phase1-20261124.tmp/runtime/run-tests.ps1 -Task test -LogName test-final-2.log` 与同一入口的 `-Task mutation -LogName mutation-final-2.log`。初次变异因 M15 的 CRLF 多行匹配失配判为 BROKEN，已中止（退出 -1）；仅将沙箱目标文本统一为 LF 后完整重跑通过，preflight、断言失败判据、真实汇总、最低通过数和超时保护均未削弱。[中止轮诊断日志](../backups/phase1-20261124.tmp/verification/mutation-final.log)保留，不能计作通过。
- **资格边界与清理**：本阶段为离线结构/行为验证，POSIX 0600 是 Windows 上的契约模拟，不是 Linux/Docker 权限实测；未使用真实云账号、真实 Broker 或手机扫码验证。仅关闭 Phase 1，不推进 P1/P2。源码及计划修改前备份保留在 `backups/phase1-20261124.tmp/`，逐项/最终日志在其 `verification/`；本次 runtime（含临时 Python 工具、pyc、测试副本）及中止轮沙箱已移入项目回收站 `backups/recycle-bin/phase1-20261124-runtime.tmp/`，可恢复，不做物理删除。运行器当前位于回收站，以上入口是实际执行记录，不表示清理后仍可直接运行。

---

## Phase 2：主服务与调度器 P1 核心 Bug 修复

### [P1-01] 修复飞书通知 URL 未用剥离后地址 & 管理员测推送漏传 `secret`
- **位置**：`server.js:677-716`（飞书推送）、`server.js:6247-6255`（`/api/notify/test`）
- **根因**：`server.js:681-685` 已从 `notify.webhookUrl` 拆出 `feishuUrl` 和 `feishuSecret`，但第 716 行 `fetch(notify.webhookUrl, ...)` 仍把带 `@secret` 后缀的原始字符串发给网络；`/api/notify/test` 构造 `testSettings.notify` 时漏传 `secret`。
- **修改步骤**：
  1. `server.js:716` 改为 `fetchWithTimeout(feishuUrl, ..., 15000)`。
  2. `server.js:6247-6255` 补上 `secret: body.secret ?? appConfig.settings?.notify?.secret ?? ''`（与第 6212 行 `/api/user/notify/test` 保持一致）。
- **验收**：飞书带 `@secret` 签名发送目标 URL 不再携带 `@secret` 后缀；管理员面板配置钉钉/飞书加签测试推送可校验通过。
- **执行记录（2026-11-24）**：飞书 URL 剥离、安全 DNS 连接固定和 15 秒预算已在 Phase 1 修复，本项保持统一安全发送入口不重做。补齐管理员通知测试的独立签名字段透传、未提供时配置继承和显式空字符串清空语义；锁住飞书独立字段优先于 URL 签名后缀、管理员鉴权与非法目标拒绝。新增 2 项离线行为回归、2 项变异（M172–M173）；先复现 235 通过/1 失败（exit=1），修复后完整 `npm test` 为 236 通过/0 失败、18 个 JS 文件语法通过（exit=0），已做只读 review。未发送真实通知；完整阶段变异于 P1-06 完成后统一运行。

---

### [P1-02] 修复 `checkExternalPowerOn` 违背用户意图强开保活
- **位置**：`server.js:1994` & `server.js:2204-2216`
- **根因**：`getDesktops()` 每次拉取都会调用 `checkExternalPowerOn(d)`，只要看到有桌面处于运行状态且 `!this.resolveTask('keepAlive').enabled`（无论原因是**用户手动关掉了保活开关**还是**账号被停用**），就无条件把 `this.account.features.keepAlive = true` 并启动 `startKeepAliveWorker()`。
- **修改步骤**：
  1. 修改 `server.js:2204-2216`：只有当 `this.account.enabled !== false && this.account.manualShutdown === true`（即之前是因电源关机联动暂时停了保活）且检测到桌面运行中时，才自动恢复 `features.keepAlive = true` 和清除 `manualShutdown = false`。
  2. 确保写入前初始化 `this.account.features = this.account.features || {};`；若 `this.account.features.keepAlive === false` 且 `!this.account.manualShutdown`，严禁擅自打开保活开关。
- **验收**：用户手动关闭天翼云账号的「常态保活」开关后，即使机器在运行并刷新桌面列表，`features.keepAlive` 仍保持 `false`，不会自动复活。

---

### [P1-03] 修复 `refreshOfficialTasks` 40010 未重试与虚假 `ok: true`
- **位置**：`server.js:2226-2317`
- **根因**：`getTaskList` 返回 `code === 40010` 时仅调用 `renewToken()` 并未重试 `getTaskList`，紧接着仍调用 `getUserPoints`；只要 `getUserPoints` 成功就把 `ok = true` 赋给总返回值，导致打卡/挂机/诊断在任务中心实际读取失败时误信内存里的过期 `officialTasks` 快照。
- **修改步骤**：
  1. 将 `ok` 拆分为 `tasksOk` 与 `pointsOk`。
  2. 当 `taskRes` 返回 40010/会话过期并成功 `renewToken()` 后，立即重发一次 `getTaskList` 请求更新 `taskRes`（避免同一轮直接失败）。
  3. 仅当 `getTaskList` 成功解析并更新 `this.metrics.officialTasks` 时才置 `tasksOk = true`；函数最终返回 `{ ok: tasksOk, pointsOk, reason }`（`ok` 必须真实代表任务列表是否可读，不可被 `pointsOk` 覆盖成 `true`）。
- **验收**：Mock `getTaskList` 500 失败而 `getUserPoints` 成功时，`refreshOfficialTasks()` 必须返回 `{ ok: false }`。

---

### [P1-04] 修复 12h 续期风暴、`stopKeepAliveWorker` 定时器泄漏与打卡倒计时误清零
- **位置**：
  - `server.js:3081-3085`（12h 自动续期）
  - `server.js:2350-2359`（`stopKeepAliveWorker`）
  - `server.js:2420-2440, 2534, 2626, 2673-2708`（`runDesktopKeepAliveSession`）
- **根因**：
  1. `runCycleLoop` 中每轮（10 秒）检查 `Date.now() - this.lastTokenRenewAt > 12h`，但 `renewToken()` 是异步且 `.catch(() => {})` 不更新 `lastTokenRenewAt`，一旦网络慢超过 10 秒或续期失败，就会每 10 秒并发打一次 `genLoginToken` + `tokenLogin`。
  2. `stopKeepAliveWorker()` 未调用 `endCurrentSession()`，也未清理 `clinkPingTimer`、`hangRetryTimer`、`signVerifyTimer`。
  3. `runDesktopKeepAliveSession` 第 2534 行（500ms `initBuf`）和第 2707 行（2500ms `checkGoalProgress`）定时器未在 `endSession()` 中清理；`checkGoalProgress`（每 15s）无重入锁且未捕获异常（未捕获拒绝会打断定时器或触发全局 `unhandledRejection`）；第 2703 行用 `(totSec - curSec) / 1000`（`totSec=1`）导致打卡观察窗口倒计时立即被覆写成 `0`；第 2626 行对超出 32 位整型的 `desktopId` 调用 `writeUInt32LE` 会抛异常并在第 2647 行被空 `catch` 静默吞掉导致 112 包未发出。
- **修改步骤**：
  1. 在 `CtYunClient` 增加 `this._renewingToken = false` 与 `this._tokenRenewRetryAt = 0`。`runCycleLoop` 中满足 12h 且 `!this._renewingToken && Date.now() >= this._tokenRenewRetryAt` 时置 `this._renewingToken = true`，成功后更新 `lastTokenRenewAt = Date.now()`，失败后设 `this._tokenRenewRetryAt = Date.now() + 15 * 60 * 1000` 并打 warning 日志，在 `finally` 复位 `_renewingToken`。
  2. `stopKeepAliveWorker()` 补充清理：`if (this.endCurrentSession) this.endCurrentSession('Worker Stopped');`、清理 `clinkPingTimer`、`clearHangRetry()`、`clearSignVerify()`。
  3. 在 `runDesktopKeepAliveSession` 内部保存 `initTimer` 和 `goalInitTimer`，并在 `endSession` 中全部 `clearTimeout`；给 `checkGoalProgress` 加 `let checkingGoal = false` 重入锁与 `try/catch`；第 2703 行在非 `isGoalHang`（即打卡模式）下不要把 `cycleCountdown` 覆盖成 `(totSec - curSec)/1000`；第 2626 行先校验 `Number.isInteger(numDesktopId) && numDesktopId >= 0 && numDesktopId <= 0xffffffff`，并在 `catch (e)` 记录错误日志而非静默吞掉。

---

### [P1-05] 修复 `TaskScheduler` 多平台串扰、重复触发、`NaN` 死循环与无超时请求
- **位置**：
  - `app/tasks/scheduler.js:22-39, 151-186, 228-246, 336-439, 689, 768-785`
  - `app/tasks/native_tasks.js:504-508`
- **根因**：
  1. `runAllAccounts()` 结尾（`768-785`）判定 `allAccountsFullyDone` 时未过滤 `ydpc` 与 `ecloud` 账号。只要有任意启用的移动云/移动公众账号，其 `officialTasks` 永远为空，导致 `allAccountsFullyDone` 恒为 `false`，每日完成通知与防空转日期永远不生效。
  2. `heartbeatTick()` 开启分项 Cron（`336-439`）时，`accounts` 仅在 2.3/2.4 兜底分支排除了 `ydpc`/`ecloud`，在 `signCron`/`aiChatCron`/`cloudHangCron`/`redeemCron` 生效分支及 2.1/2.2 兜底分支均未过滤，导致用移动云/移动公众账号去打天翼云任务接口！同时 `redeemCron` 仅调用 `client.getRewards()` 查商品列表，从未真正执行下单；且未配置分项时的 `else if` 兜底分支没有设置 `this.lastTriggerMinute = currentMinKey`，会在同一分钟内与 `scheduleNextRun()` 共触发最多 3 次。
  3. `scheduleNextRun()`（`228-246`）若 `executeTime` 解析出 `NaN`，`candidate.getTime()` 为 `NaN`，落入 `!nextTargetDate` 后 `delayMs = Math.max(1000, NaN) = NaN`，`setTimeout(..., NaN)` 退化为 ~1ms 无限递归死循环。
  4. `checkStartupCatchup()`（`151-186`）未检查仅有 `autoRedeem` 未执行的账号，会错误置 `lastCompletedDate = todayStr` 跳过后续补跑。
  5. `scheduler.js:689` 下单 `fetch` 无超时控制（违反组 4 `#35` 防串行队列卡死设计）；`matchCronField`（`22-30`）遇 `*/0` 或非数字 step 会产生除零 `NaN`。
  6. `native_tasks.js:505` `executeNativeHang` 对 `ydpc` 早退，但漏了 `ecloud`。
- **修改步骤**：
  1. `scheduler.js:769` 过滤仅针对天翼云账号：`const ctyunAccounts = accounts.filter(a => a.platform !== 'ydpc' && a.platform !== 'ecloud');`，用 `ctyunAccounts` 判定 `allAccountsFullyDone`（且当 `ctyunAccounts.length === 0` 时直接视作无需天翼云汇总或跳过汇总通知）。
  2. `scheduler.js:336-439`：在保留回归静态正则要求（`platform !== 'ecloud'` `>=5` 处及特定组合表达式）的前提下，在 2.1~2.4 的 Cron 分支和兜底分支中一律过滤 `acc.platform !== 'ydpc' && acc.platform !== 'ecloud'`；从 `runAllAccounts` 抽取 `runAutoRedeemForAccount(acc, client)` 供主流程与 `redeemCron` 共同调用；在 2.1~2.4 兜底分支及 `scheduleNextRun` 触发前统一检查并更新 `this.lastTriggerMinute = currentMinKey`（确保与 `heartbeatTick` 互斥不重跑）。
  3. `scheduler.js:114-120` 与 `228-246`：严格校验 `HH:mm` 正则（`00-23:00-59`），过滤掉非法项（全非法时回退 `['01:20']`），并在 `scheduleNextRun()` 加 `Number.isFinite(delayMs)` 防御。
  4. `scheduler.js:151-186`：在 `checkStartupCatchup()` 若某启用天翼云账号开启 `autoRedeem` 且今日 `lastRedeemDate !== todayStr`，置 `allDone = false`。
  5. `scheduler.js:689` 增加 `signal: AbortSignal.timeout(15000)`；`matchCronField` 校验 `stepNum > 0 && Number.isFinite(stepNum)` 并支持 `N/step` 写法。
  6. `native_tasks.js:505` 将 `if (acc.platform === 'ydpc')` 改为 `if (acc.platform === 'ydpc' || acc.platform === 'ecloud')`，直接复用该处返回，**确保文件内 `isCompleted: true` 硬编码字面量依然恰好为 3 处**（不触发回归组 3 失败！）。

---

### [P1-06] 修复 HTTP 路由健壮性、侧车进程泄漏、多用户/平台边界 Bug
- **位置**：`server.js` 多处、`app/auth_manager.js`、`app/ctyun_encryption.js`
- **修改清单**：
  1. **顶层异常处理与 Body 限流**（`server.js:3384-3396, 3491-3493`）：
     - `http.createServer(async (req, res) => { try { ... } catch (err) { ... } })` 捕获路由未处理异常并返回 `500`，`new URL(req.url, \`http://${req.headers.host || 'localhost'}\`)`。
     - `parseJsonBody(req, maxBytes = 2 * 1024 * 1024)` 处理 `req.on('error')`、`req.on('aborted')` 与体积超限拒绝（413 / reject），避免挂起。
  2. **清理 `GET /api/accounts` 隐式写状态副作用**（`server.js:4214-4240`）：
     - 对保活状态同步统一改用 `resolveTaskEnabled(acc, null, 'keepAlive').enabled`（修复仅用 `acc.features?.keepAlive === true` 导致新/导入账号 `undefined` 被遗漏的问题）；防止在 `manualShutdown` 或 `sessionExpired` 时无效重复启停。
  3. **管理员拖拽排序与配额/导入校验**（`server.js:4311-4334, 6368, 6424, 6506-6521`）：
     - `/api/accounts/reorder`：当 `session.role === 'admin'` 时可按 `orderedIds` 重排全量账号（合并未包含项）；普通用户保留仅重排自己账号。
     - `/api/config/import`：`merge` 模式下只统计导入列表里**不与现有账号重复的净新增数量**计入配额；`isQrAccount = !isYdpc && !isEcloud && ...`（避免把未设密码的 ecloud 当成 ctyun QR）；导入 `ecloud` 账号时先 `client.refreshDesktops()` 再启动 `startKeepAliveWorker()`；管理员还原 `body.settings` 时校验 Webhook SSRF 并调用 `taskScheduler.scheduleNextRun()` 重载定时任务。
  4. **释放 `EcloudClient` 侧车进程防止僵尸进程泄漏**（`server.js:46-53, 4588-4593, 5032, 6381`）：
     - `/api/accounts/ecloud/add` 登录失败或抛错分支，调用 `await draftClient.stop(true)` 杀掉刚拉起的临时侧车；
     - `DELETE /api/accounts/:id` 与 `/api/config/import`（`overwrite` 模式）若 `typeof client.stop === 'function'`，优先调用 `client.stop()`（兼容 `ydpc`/`ctyun` 只提供 `stopKeepAliveWorker()`）；
     - `SIGINT`/`SIGTERM` 处理函数遍历 `clientInstances` 调用 `stop()` / `stopKeepAliveWorker()` 并停止 `taskScheduler`、关闭 `logPersister` 后再退出（设最多 2 秒兜底强退定时器）。
  5. **天翼云专属路由补齐平台守卫 & 扫码匹配排除 `ecloud`**（`server.js:5157, 5550-5586, 5602, 5651, 5992-6010, 6126-6134`）：
     - `server.js:5157` 扫码查找已有账号补上 `&& a.platform !== 'ecloud'`。
     - `/web-active`、`/web-close`、`/web-launch`、`/order`、`/desktops`（天翼云形态）及 `/api/rewards` 遍历账号前先判断 `(!acc.platform || acc.platform === 'ctyun')`，避免对 `ydpc`/`ecloud` 客户端误调 `client.getDesktops()` / `client.getRewards()` 抛错。
     - `server.js:5992-6000` 天翼云多机账号关机某台桌面时，将该台 `desktop.keepaliveEnabled = false`，仅当名下**全部**桌面均为关闭或已关机时才关闭账号级 `features.keepAlive` 并打上 `manualShutdown = true`。
     - `server.js:6126-6134` 设置热更新循环仅修改 `ctyun` 客户端的 `keepAliveSeconds`。
  6. **`AuthManager` 与 `CtYunEncryption` 边界修复**：
     - `app/auth_manager.js:245`：`const parsed = parseInt(maxQuota, 10); user.maxQuota = (Number.isFinite(parsed) && parsed >= 0) ? parsed : 2;`（允许配额设为 `0`）。
     - `app/auth_manager.js:95-99, 283-289`：`verifySession` 动态同步 `session.username = user.username;`；`updateAdminUsername` 同步后调用 `this._persistSessions();`。
     - `app/ctyun_encryption.js:8-18, 64-67`：检验 `Buffer.isBuffer(data) && data.length >= 16 + 166`（不足则抛清晰错误）及 `resultBytes.length > keyLen` 时截取尾部 `keyLen` 字节防止 `Buffer.copy` 越界异常。

---

## Phase 3：移动爱家 YDPc 协议栈 P1 Bug 修复（`app/ydpc/`）

### [P1-07] 修复 `verifyKeepAliveEffect` 必现 `ReferenceError: originCn is not defined`
- **位置**：`app/ydpc/ydpc_client.js:1394, 1478, 1516, 1534-1536`
- **根因**：`verifyKeepAliveEffect(durationSec = 60, intervalSec = 15)`（L1394）在第 1478 行拼接日志使用了未定义的 `${originCn}`，而 `startEffectWatchdog`（L1516）传入的第 3 参数 `{ origin: 'auto' }` 被忽略，且 L1534-1536 的 `catch (e)` 静默吞错。导致手动核验和自动核验看门狗**100% 崩溃**且看门狗从不报警。
- **修改步骤**：
  1. 将 L1394 签名改为 `async verifyKeepAliveEffect(durationSec = 60, intervalSec = 15, opts = {})`。
  2. 在函数体开头声明 `const originCn = (opts && opts.origin === 'auto') ? '保活效果自动核验' : '独立状态验证';`。
  3. 在 L1534-1536 的 `catch (e)` 中添加 `this.appendLog('KeepAlive', \`[\${accName}] 保活效果核验看门狗执行异常: \${e.message}\`, 'warning', accName, 'ydpc');`。
- **验收**：对 Mock 的 `YdpcClient` 调用 `verifyKeepAliveEffect(1, 1)` 与 `verifyKeepAliveEffect(1, 1, { origin: 'auto' })`，正常返回完整 `report` 对象且无 `ReferenceError`。

---

### [P1-08] 修复 `refreshVms()` 底座缓存失效与 `YdpcClient` 状态机 Bug
- **位置**：`app/ydpc/ydpc_client.js`（L144/158-262/374/445/497/556/593/1121-1373/1600/1682/1851/1862-1916）
- **修改步骤**：
  1. **修复底座探测缓存被跳过**（`158-262`）：将 `const oldVmsMap = new Map(...)` 移到探测循环之前。探测循环内先取出 `const old = oldVmsMap.get(String(vm.userServiceId));`，改为 `const needProbe = !(old && old.vendor) || old.vendorProbeStale === true;`。确认每次 60 秒轮询已有已知 `vendor` 的主机**不再**重复调用 `getFirmAuth()`。
  2. **修复 `stopDataPlaneTask` 键类型不匹配**（`1121-1131, 1620`）：函数入口统一 `const key = String(usid);`，后续 `this.dataPlaneTasks.get(key)`、`this.dataPlaneTasks.delete(key)`、`_recordVmAction(key, ...)` 全部使用 `key`。
  3. **修复 `startDataPlaneTask` 闭包捕获过期 `vm` 引用**（`1133-1368`）：
     - 在循环每一轮开始，通过 `const liveVm = (this.account.vms || []).find(v => String(v.userServiceId) === usid) || vm;` 获取最新 `vm` 实例，并用 `liveVm._route` 判定分支、在时长耗尽时将 `_durationExhausted = true` 写入 `liveVm`（以及当前 `vm`）。
  4. **修复数据面零退避死循环、误清零失败计数与不可取消问题**（`1181-1368`）：
     - 为每个 `task` 增加 `const ac = new AbortController(); task.abortController = ac;`（或取消回调集合），在 `stopDataPlaneTask` 中调用 `ac.abort()`，让 `runScgSession`、`runTlsSpiceSession`、`cagBootVm`、`dialCagTcpRaw` 以及异常分支里的 30s/60s `setTimeout` 可被立即唤醒中止，避免出现同一个 `usid` 两个并发任务。
     - SCG 分支（`1181-1211`）：检查 `session.channels.length === 0 || session.error`，若建连/通道认证未完成或极短时间异常退出，走 `_noteDataPlaneFailure(...)` 并睡眠退避（如 15~30s），**不得**调用 `_noteDataPlaneProgress`。
     - TLS/Raw 分支（`1251-1328`）：若切片未维持正常周期即发生 `session.errors > 0` 或 `counters.error` 且未建起过稳定持活，同样走 `_noteDataPlaneFailure(...)` + 退避延迟再重连。
  5. **修复关闭 MQTT 开关后不停掉已有连接**（`1862-1865`）：去掉外层的 `if (this.account.features?.mqttKeepAlive !== false)` 门控，改为直接 `await this.ensureMqttConnection().catch(() => {});`（`ensureMqttConnection` 内部首段已包含开关关闭时自动 `disconnect()` 的逻辑）。
  6. **校验 `this.login()` 结果**：在 `144, 374, 445, 497, 556, 593, 1155` 检查 `const lr = await this.login(); if (lr && lr.success === false) throw new Error(lr.error || 'SOHO 登录失败');`。
  7. **其他一致性修复**：
     - `1600` 行改用 `const anyRunning = vms.some(v => !isYdpcVmOff(v));`（与 L297 及回归组 32 一致）；
     - `1851` 行从 `this.dataPlaneTasks.get(String(vm.userServiceId))?.path` 动态显示通道名称（`SCG · trunk+SPICE` / `IPv4 · TLS+SPICE` / `IPv6 · raw ZTEC`）；
     - `564, 570, 632, 678, 688, 698, 704` 的 `setTimeout(() => this.refreshVms()...)` 存入 `this._pendingRefreshTimers = new Set()` 并在 `stopKeepAliveWorker()` 中统一清理；
     - `611 & 621` 合并重复的 `resolveVmRoute(vmRef, firmAuth)` 调用。

---

### [P1-09] 修复 `cag_boot.js` 密码双重 URL 编码与 HTTP/重试边缘 Bug
- **位置**：`app/ydpc/cag_boot.js:258-273, 303, 395, 561, 745-776, 894-945, 950-972, 1034-1081, 1170-1172, 1222-1225`
- **修改步骤**：
  1. **修复密码双重编码**（`950-972`）：
     - ⚠️ 必须保留 `zteCsapEncryptQueryValue()` 返回 `%2B` 的行为（受回归组 8 断言约束：`tests/regression.test.js` 验证其输出与 Python 口径一致）。
     - 在 `cag_boot.js:264` 可复核 RFC3986 编码（编码 `!'()*`）；在 `cag_boot.js:971` 拼接 `tokenQuery` 时对 `k === 'password'` **跳过** `encodeURIComponent`（即 `k === 'password' ? String(v) : encodeURIComponent(String(v))`），确保 `%2B` 不被二次编码成 `%252B`。
  2. **修复 `cagHttpsRequest`**（`745-776`）：增加 `res.on('error', ...)` 与提前截断 `res.on('close', ...)` 处理；添加 `settled` 布尔守卫防止 `timeout` 与 `error` 重复记录日志与重复 reject。
  3. **修复 `1000100` 会话失效重试**（`1034-1035, 1079-1081`）：提取 `fetchToken()` 闭包，收到 `1000100` 时真正重新请求 `cs_getToken.action` 刷新 `accessToken` 与 `connectQuery`/`asyncQuery` 后再重试。
  4. **小边界修正**：
     - `303`：`stableStringify` 数组内 `undefined` 按标准 JSON 序列化为 `'null'`；
     - `395`：先判断 `inner && typeof inner === 'object' && !Array.isArray(inner)` 再挂 `inner._securityParams`；
     - `561`：`d.desktopType == null ? 1 : Number(d.desktopType)` 保留有效 `0`；
     - `1170-1172`：早退返回真实耗时 `Math.round((Date.now() - startedAt) / 1000)`；
     - `1222-1225`：`parseConnectCommand` 消耗参数值后 `i++`；
     - `894-945`：检查 `getPublicKey` 是否仅为校验网关可达，若未用到 PEM 可改为警告降级或注释明确用途；`499, 516` 复用单次 `os.networkInterfaces()`。

---

### [P1-10] 修复 `scg_keepalive.js` 100% CPU 死循环、10s 空等、内存/精度/协议问题
- **位置**：`app/ydpc/scg_keepalive.js`（L74-79, 202-209, 400-419, 472-488, 616-681, 703-744, 844-1157）
- **修改步骤**：
  1. **修复 100% CPU 死循环**（`982`）：将 `waitMainInit` 的 `try { frame = await reader.readFrame(2000); } catch (e) { continue; }` 改为 `catch (e) { break; }`（socket 关闭或错误立即退出）。
  2. **修复每次建连空等 10 秒**（`703-744`）：改造 `recvUpTo`（或新增 `recvScgAuthReply`）：收到首个数据块后，若已满足 SCG 认证响应最小合法长度（例如首字节 `!== 0x00` 拒绝包，或成功包 `>= 9` 字节且读取完成 / 短空闲如 150ms 无后续字节）即刻 `resolve`，避免无谓等待满 10 秒超时。
  3. **修复 `waiters` 闭包泄漏**（`857-860`）：`readFrame` 超时回调触发时，从 `waiters` 数组中 `splice` 移除已超时的 waiter 引用。
  4. **修复 64 位 ID 精度丢失**（`844-850, 1105-1110`）：`field1`、`field2`、`targetCid`、`senderCid`、`extraId` 全链路保留为 `BigInt`（仅通道比较使用 `frame.field2 === BigInt(SCG_CH_MAIN)`）。
  5. **修复固定帧数截断与空会话空跑 900s**：
     - `954, 1020`：`authenticateChannel` 和 `waitDisplayMark` 改为以 `Date.now() < deadline` 为准，移除 10/20 帧硬上限。
     - `1039-1058, 1147-1157`：`scgHandshake` 完成阶段若 `main`（或关键通道）未能认证成功，向 `runScgSession` 返回/抛出明确错误（禁止进入 900 秒 `holdScgSession` 假持活）。
  6. **修复协议与辅助边界**：
     - `202-209`：将 `buildScgAuthPacket` 的校验收紧至 `if (encrypted.length > 0xff) throw ...` 与实际 1 字节编码一致（或核对协议头是否为 2 字节长度）；
     - `472-496`：`cemHttpsRequest` 补全 `Content-Length`、`res.on('error')`/`res.on('close')` 与 `e.cause` 链判断；
     - `616, 681`：`cemBootVm` 保留 `timeoutMs: 120000` 基准的同时（注意回归组 30 静态正则检查 `/timeoutMs:\s*120000/`），对整体等待预算取剩余时间 `Math.min(120000, Math.max(5000, deadline - Date.now()))`（如写成变量覆写形式即可兼顾静态约束与实际预算）；
     - `646-658`：`getVmReadyStatus` 轮询检查 HTTP 状态码与 `json.code` 报错；
     - `934-941, 960-967, 1026-1032`：在 `scgHandshake` 中对 `frame.field2 === BigInt(SCG_CH_DISPLAY)` 的帧不要同时调用 `reply(frame)` 和 `handleDisplayPayload(frame.payload, progress)`（只走其中一个分支，消除重复冲突回包）。
  7. **⚠️ SPICE 客户端操作码核对项（`74-79, 400-419`）**：
     - 当前 `SPICE_MSG` 定义了 `PONG: 0x0005`、`ACK_SYNC: 0x0006`（按 SPICE 协议规范，C2S 应为 `ACK_SYNC: 0x0001`、`PONG: 0x0003`，而 `0x0006` 是 `DISCONNECTING`）；但 `tests/regression.test.js:4500,4504` 明确断言 `0x0006` / `0x0005`。
     - **执行要求**：先对照 SCG 真机抓包（`analysis/` 或实机测试）确认深信服魔改/标准 SPICE 的真实 C2S opcode；若证实服务端期望 `0x0001`/`0x0003`，再**同时**修改 `scg_keepalive.js` 与 `tests/regression.test.js:4500,4504`。

---

### [P1-11] 修复 `zte_cag_tls.js` 子通道 OOM、47.6ms 流错位与 TLS 无限挂起
- **位置**：`app/ydpc/zte_cag_tls.js:242, 285-290, 319-323, 378-383, 556-577, 746-822, 882-901, 974-987`
- **修改步骤**：
  1. **消除 links 2–8 缓冲内存泄漏**（`319-323, 746-768`）：给 `CagMuxLink` 增加 `drainMode`（或 `setDiscardIncoming(true)`）；在 `setupSubChannels` 完成握手并发送 `DISPLAY_INIT`/`INPUT_INIT` 后，将非读取子通道切换为丢弃后续载荷（仅保留心跳/统计或上限缓冲），杜绝 `Buffer.concat` O(N²) 增长与 OOM。
  2. **修复 47.6ms 读超时导致 SPICE 流错位**（`556-577, 796-822`）：
     - 将 21Hz `displayType3HeartbeatFrames` 发送拆分为独立的 `setInterval` 定时器（带 `try/catch`，出错触发主循环退出并在 `finally` 清理）；
     - 主读循环恢复正常读超时（如 `1000ms`），并让 `RawState.readMessage` **仅在收齐完整头+体后才推进偏移量**（或通过先读完整缓冲状态机，未收齐前超时抛出 `ETIMEDOUT` 时不丢失已读出的 6B 帧头，下次继续补读包体）。
  3. **修复 `upgradeToTls` 无限挂起与 `CagMux` 清理**（`882-901, 974-987`）：
     - 将 `timeoutMs` 传入 `upgradeToTls`：内部挂载握手超时定时器及 `socket.once('close', ...)`，超时或对端提前关闭时销毁底层 socket 并 reject；握手成功后清理定时器。
     - 修复 `896` 行 `onLog` 漏传第 1 参数：改为 `onLog('CAGTLS', ..., 'warning')`。
     - `CagMux._failAll` 设置 `this._closed = true`；`CagMuxLink.close()` 从 `this.mux._links` 中删除；`readExact` 在 `_waiters.length > 0` 时禁止插队，严格 FIFO。
     - `817` 行断开告警条件从 `counters.messages === 0 && counters.ticks === 0` 改为 `counters.messages === 0`（因首次循环即递增 `ticks`）。

---

### [P1-12] 修复 `soho_client.js` / `mqtt_client.js` / `cag_client.js` / `zte_cag_raw.js` / `product_route.js`
- **位置与修改步骤**：
  1. **`app/ydpc/soho_client.js:204-209, 280-337`**：
     - `fetchApi` 第 204 行自动重登增加条件 `!path.startsWith('/login/')`（杜绝 `/login/*` 接口返回“已失效”时无限递归调用 `this.login()`）。
     - 在 `SohoClient` 上维护 `this._reloginPromise`，使并发过期的多个请求共享同一次 `login()`。
     - 顺带清理未用的 `https` 引用（L2），规范 `getLoginPublicKey`/`bootstrapPublicKey` 对已有 PEM 头尾的兼容，`getFirmAuth` L401 修复 `res.msg` 为空时格式化出 `undefined`。
  2. **`app/ydpc/mqtt_client.js:86-112, 135-199, 214-258`**：
     - 完整解析 MQTT 控制包（Fixed Header 1B + Variable Byte Integer 剩余长度），跳过非 `PINGRESP`（例如服务端 `PUBLISH`），不再 `break` 卡死 `recvBuf`。
     - CONNACK 拒绝时（L152-166）立即调用 `this.disconnect()` 关闭连接。
     - `startPingLoop` 检测上一轮 `lastPingTime > lastPongTime`（超过心跳超时阈值无响应）即主动判定死链并关闭/触发重连。
     - `dns.lookup` 纳入 `timeoutMs` 总超时预算，并在解析返回后检查 `if (this.isClosedManually) return;` 防止关闭竞态。
     - `socket.on('close')` 若 `!isResolved` 立即清理定时器并 `reject`；`disconnect()` 在 `end(DISCONNECT)` 后设短延迟或回调再 `destroy()`。
  3. **`app/ydpc/cag_client.js:144-226`**：
     - 校验 `cagPort`/`vmcPort` 为合法端口整数（`1-65535`）；
     - Stage 4 移除危险的 `|| recvBuffer.length >= 4` 假成功条件，严格匹配 200 状态或解析协议响应字段；
     - 增加 `settled` 守卫，进入 `stage === 3` 时 `clearTimeout(timeoutTimer)`，并在 `close` 中无论处于哪个阶段均调用 `cleanup()`、在 Stage 1/2 提前断开时立即 `reject`。
     - `stage === 3` 期间停止无限向 `recvBuffer` 拼接数据。
  4. **`app/ydpc/zte_cag_raw.js:109-198, 234-256`**：
     - 保存 `let tickTimer = null;`，在 `finish()` 内执行 `clearTimeout(tickTimer)` 并移除 `onData`、`onError`、`onClose` 全部监听器；
     - `ipv6ToBytes` 使用严格正则/`net.isIPv6` 先行校验格式后再展开压缩段，拒绝多个 `::` 或缺段地址；`dialCagTcpRaw` 保留 36B 之后粘包数据。
  5. **`app/ydpc/product_route.js:160-203, 268-270`**：
     - 在 `classifyZteError` 中调整判定顺序或收紧规则：`HARD_PATTERNS` 中的证书/网络/解析异常关键字必须在泛化的 `/token/i`、`/会话/`、`/已失效/` 之前（或将 `TOKEN_RETRY_PATTERNS` 收紧为特定鉴权错误如 `/1000100/`、`/\b400[13]\b/`、`/未登录|未授权|鉴权失败|登录失效/`、`/(?:access)?token.{0,10}(?:失效|过期|无效)/i`），防止把 `"Unexpected token '<'"` 或 `"证书已失效"` 误判成 `tokenRetry`；把 `/\b104\b/` 锚定到错误码上下文（如 `/(?:code|错误码)[=:\s]*104\b/`）。
     - `resolveInnerRoute`（`268`）用 `net.isIPv6(bare)` 替代 `bare.includes(':')`，防止把 `1.2.3.4:5900` 误判为 IPv6。

---

## Phase 4：移动公众 Ecloud 侧车与桥接层 P1 Bug 修复

### [P1-13] 修复多进程共享文件覆写与临时文件竞态
- **位置**：
  - `app/ecloud/ecloud_client.js:123`
  - `app/ecloud_engine/sidecar.py:118-121, 144-163, 315-326, 533-535, 552-562`
  - `app/ecloud_engine/login_rate_limit.py:34-36, 58-112, 99-104, 163-232`
- **根因**：每个 `EcloudClient` 均拉起独立 Python 进程，全部读写同一个 `ECLOUD_SESSION_FILE` 与 `ECLOUD_LOGIN_RATE_LIMIT_FILE`。`sidecar.py` 只把本进程 1 个 `_SESSIONS` 条目序列化写回并全量覆盖文件；`login_rate_limit.py` 进程内只首次读取一次文件；且二者写入临时文件均硬编码 `.tmp` 后缀而无跨进程文件锁。
- **修改步骤**：
  1. **会话文件按进程安全隔离或锁合并（二选一，推荐组合）**：
     - 在 `sidecar.py` 与 `login_rate_limit.py` 新增跨进程文件锁工具（Linux 使用 `fcntl.flock`，Windows 使用 `msvcrt.locking`，封装于 `with file_lock(lock_path):`）；
     - 临时文件名改为同目录唯一名称：`f".{path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"`，写盘后（Linux `0o600`）再 `os.replace()`；
     - `sidecar.py:_persist_sessions()` 在文件锁内先读入现有 `sessions.json`，删除本进程显式 `pop` 登出的 `sid`（用 `_REMOVED_SESSIONS` 记录），合并/更新当前 `_SESSIONS` 后再写回（保留其他账号进程写入的会话！）；或由 `EcloudClient` 为非共享模式传入按 `account.id` 隔离的环境变量文件路径（⚠️ 若改为按账号分文件，须注意兼容 `Dockerfile` 的 `ECLOUD_SESSION_FILE` 约定与测试，因此**优先建议“锁 + read-modify-write 合并 + 唯一 tmp 文件”方案**）。
  2. **修复 `login_rate_limit.py` 并发与 TOCTOU 竞态**：
     - 取消“仅加载一次”缓存：在锁保护下每次 `status`/`record_attempt`/`guard_login` 均从磁盘重新加载最新状态后再合并写回（或对比文件 `mtime_ns`）。
     - `guard_login()` 把“检查锁定 + 记录尝试”合并到同一 `with _lock:` + 跨进程文件锁临界区中。
     - 计算 `unlock_in` 使用 `min(ts)` 而非 `ts[0]`（防御磁盘乱序）。
  3. **持久化 `loginUid`**：在 `sidecar.py:150-156` 保存 `loginUid`，在 `op_session_restore`（`315-326`）中恢复 `loginUid`，使服务端会话状态机跨重启保持一致。

---

### [P1-14] 修复 Windows 编码崩溃、未监听 `stdin` EPIPE 与进程管理竞争
- **位置**：`app/ecloud/ecloud_engine.js:45-64, 160-256, 323-329, 346-364` & `app/ecloud_engine/sidecar.py:55-72`
- **修改步骤**：
  1. **统一 IPC 字符集为 UTF-8**：
     - `ecloud_engine.js:193` `spawn` 时写入 `env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...process.env, ...this.extraEnv }`；`probePythonInterpreter` 也合入 `PYTHONUTF8`/`PYTHONIOENCODING`。
     - `sidecar.py` 入口配置 `for s in (sys.stdin, sys.stdout, sys.stderr): if hasattr(s, 'reconfigure'): s.reconfigure(encoding='utf-8', errors='replace')`。
  2. **防止 `child.stdin` 异步 `EPIPE` 崩掉 Node 服务**：`ecloud_engine.js:195` 在保存 `this._proc = child;` 后立即挂载 `child.stdin.on('error', (err) => { /* 交由 exit/pending 处理，防止未捕获 stream error 崩溃进程 */ });`。
  3. **修复 `probePythonInterpreter` 竞态截断**：`ecloud_engine.js:58` 将 `child.on('exit', ...)` 改为 `child.on('close', ...)`，并添加 `let settled = false;` 防止重复 resolve。
  4. **修复旧子进程 `exit` 误伤新实例 & 优雅 `stop()` 缺陷**：
     - `child.on('error')` 与 `child.on('exit')` 首行加入 `if (this._proc !== child) return;`；
     - 用单一 `this._startPromise` 协调并发 `start()` 调用，移除容易泄漏监听器并可能提早超时的 `_awaitReadyEvent`；
     - `stop()` 先置 `this._stopping = true`（`exit` 回调据此区分正常停止与异常崩溃，不再误记「协议引擎已离线」error），清零 `this._proc = null`、调用 `this._failAllPending('引擎已主动停止')`、取消 `Promise.race` 的 2s 定时器，并将 `if (!proc.killed)` 修正为 `if (proc.exitCode === null && proc.signalCode === null)`，取消 `killer` 定时器防止事件循环挂留。

---

### [P1-15] 修复 `EcloudClient` 会话恢复、`autoBootEnabled` 丢失与主动续期逻辑
- **位置**：`app/ecloud/ecloud_client.js:88-93, 132-141, 191-221, 246-332, 366-380, 518-575, 620-660, 785-797`
- **修改步骤**：
  1. **保留单机 `autoBootEnabled`**：`refreshDesktops()`（`373-376`）差量合并补上 `if (old.autoBootEnabled !== undefined) d.autoBootEnabled = old.autoBootEnabled;`。
  2. **修复引擎重启或手动执行时的会话缺失**：
     - 在 `ensureSession()` 添加实例级并发去重 `if (this._ensureSessionPromise) return this._ensureSessionPromise;`（防止启动初期重复触发 `login.begin` 消耗 2 次限流配额）；
     - `runKeepAliveOnce()` 开头与 `runCycle()`（当 `!this._sessionReady` 时）显式 `await this.ensureSession()`（若 `ensureSession()` 失败且 `needsInteractiveLogin` 为 true，跳过 L1/L2 并设置合理提示）；
     - `loginInteractive()` 成功路径补齐 `this._lastTokenRefreshAt = Date.now(); this._suspendedNotified = false;`。
  3. **修复主动续期失败 20s 刷屏死循环**：在 `runCycle()`（`638-654`）先判 `!this.metrics.needsInteractiveLogin && (!this._tokenRefreshNotBefore || Date.now() >= this._tokenRefreshNotBefore)`；收到 `skipped === 'cooldown'` 时按 `(rr.nextInSec || 120) * 1000` 设置 `_tokenRefreshNotBefore`；收到 `needInteractive` 时置 `needsInteractiveLogin = true` 并停止主动重登；抛出异常时至少退避 2 分钟。
  4. **其他修复**：
     - `startEngine()`（`191-221`）：在 `isReady()` 快路径或统一校验中先检查 `importError` 再检查 `credentials !== 'loaded'`；校验不通过时关闭侧车并计入 `_engineFailStreak` 退避，不再返回半残 `READY` 引擎。
     - `parseUptimeSeconds()`（`88-93`）：改为独立匹配天/小时/分/秒四个正则片段，支持带前导空格及各单位间空格，全未匹配才返回 `-1`。
     - `engine.on('exit')`（`132-141`）：同步置 `this.metrics.engine.state = this.engine.state; this.metrics.engine.pid = null;`。
     - `loginSendSms()`（`332`）：`const useMobile = mobile || opts.mobile || this.account?.mobile || this.account?.user || '';`。
     - `keepaliveL2()`（`518-525`）：处理 `rr.needInteractive`（同步置 `needsInteractiveLogin = true` 并打日志），对齐 L1 口径。
     - `powerDesktop()`（`555`）：记录定时器并校验 `this.workerRunning` / `this._stopped`，在 `stop()` 中清理，防止删除账号后定时器复活拉起侧车。
     - `_effectivePowerState()`（`785-797`）：按组 34 注释所述信号优先级（探测 > 平台操作表 > 平台状态），若 `d.powerOnEnable === true` 且 `platformPower !== 'off'` 同样判 `off`（需同时用组 34 单元测试验证既有案例全过）。

---

### [P1-16] 修复 Python 侧车网络异常处理、超时预算、电源判定与 FD 泄漏
- **位置**：`app/ecloud_engine/ecloud_client.py`、`keepalive.py`、`desktop_session.py`、`desktop_list.py`、`login.py`、`config.py`、`device.py`、`sidecar.py`
- **修改步骤**：
  1. **封装 `requests.RequestException` 维护三态与容错**：
     - 在 `EcloudHttpUtil.post()`（`ecloud_client.py:206`）中捕获 `requests.RequestException`，统一包装为 `EcloudNetworkError(EcloudError)`（继承自 `EcloudError`，设 `errorCode="NETWORK_ERROR"`），或让 `keepalive_probe` / `DesktopSession.keepalive_once` / `login.py` / `desktop_list.py` 捕获 `(EcloudError, requests.RequestException)`。确保单端点超时时 L1 继续尝试其余端点并正确产出 `ok=None`。
  2. **对齐 RPC 超时预算**：
     - 在 `EcloudHttpUtil.post()` 支持可选参数 `timeout: float | None = None`；
     - `DesktopSession.renew_session_status()` 与 `report_connect_event()`（`desktop_session.py:142-189`）传入短超时（例如 `timeout=5.0`），且当 `report_uptime` 因 `tokenExpired` 或明确失败退出时按需跳过，确保单次 `keepalive.l2` 不会超过 Node 侧 `45s` `requestTimeoutMs`。
  3. **修复 `normalize_power_state` 误判 & `Desktop` null 字段**：
     - `desktop_list.py:45-66`：在 `_POWER_OFF_SUBSTR` 之前先检查明确的负向词（`"unavailable"`, `"inactive"`, `"abnormal"`, `"not_running"`, `"不可用"`, `"异常"`）或对英文状态改用词边界正则 `re.search(rf'(?<![a-z]){tok}(?![a-z])', s)`，绝不允许把 `"unavailable"` 判成 `'on'`。
     - `desktop_list.py:111-115`：改为 `str(m.get("instanceId") or "")` 等，避免 JSON 值为 `null` 时 `Desktop.__repr__` 报 `TypeError`。
  4. **修复 `login.py` 空 Token 假成功与分类错误**：
     - `login.py:86-89, 250-262, 284-287, 314-317`：在全部 4 处返回 `LoginResult.SUCCESS` 前校验 `if not token: return {"status": LoginResult.FAILED, "access_token": None, "error": "服务端未返回 accessToken"}`。
     - `login.py:53-63`：`normalize_sms_code` 改为 `"".join(ch for ch in code if ch.isascii() and ch.isalnum())`，彻底剔除零宽字符/方向控制符。
     - `login.py:110-158`：修复 `_classify_login_error` 取 `body.get("userId")` 与 `_classify_dict_error` 兼容已解包 `body` 结构。
  5. **修复 `EcloudHttpUtil` FD 泄漏、动态 RSA 分块与 HTTP 401 识别**：
     - `ecloud_client.py`：新增 `def close(self): self._session.close()`；`sidecar.py` 在 `op_login_begin`、`op_session_relogin`、`op_logout` 替换或销毁会话时关闭旧 `http` 实例（`relogin` 失败丢弃临时 `http` 前也关闭）。
     - `ecloud_client.py:78, 95`：`rsa_encrypt`/`rsa_decrypt` 按密钥长度动态计算块大小（`key.size_in_bytes() - 11` / `key.size_in_bytes()`）；使用 `sentinel = object()` 检测 `PKCS1_v1_5.decrypt` 解密失败并抛 `EcloudError`。
     - `ecloud_client.py:250-261`：校验证明 `isinstance(envelope, dict)`、`isinstance(envelope.get("params"), str)`、`isinstance(obj, dict)`，防御服务端异常 JSON 结构。
     - 合并 `keepalive.py` 与 `desktop_session.py` 的 `_is_token_expired` 至共用函数，增加 `str(err.code).strip() == "401"` 判断，并将模糊词 `"过期"`、`"授权"` 收紧为 `"token过期"`、`"授权失效"` 等避免误伤。
  6. **环境与配置防崩**：
     - `sidecar.py:114` 安全解析 `ECLOUD_RELOGIN_COOLDOWN_SEC`（`try/except ValueError` 回退 `1200`）；`352` 仅在 `not params.get("quiet")` 时调用 `rate_limit_mod.record_attempt(username)`；
     - `config.py:57-98` 对环境变量 `strip()`、明确配置的缺失 PEM 文件不再静默跳过、非 dict 凭据文件报 `CredentialMissing`；
     - `device.py:157-159` 若 `machine-id` 非 32 位合法 hex，采用 `uuid.uuid5(uuid.NAMESPACE_DNS, mid).hex` 标准化长度，不再拼出残缺 UUID。

---

## Phase 5：前端控制台 P1 Bug 修复（`app/static/`）

### [P1-17] 激活死代码 `updateAccountsInPlace` 并修复结构指纹与过时 `onclick`
- **位置**：`app/static/app.js:544-548, 1760-1994, 2115-2134`
- **根因**：`loadAccounts(isSilent = false)` 在 `:548` 调用 `renderAccounts()` 时未传入 `isSilent`，导致 `updateAccountsInPlace()` 成为**永不执行的死代码**，每 5 秒整页销毁重建所有卡片 DOM。同时，直接补传 `isSilent` 会激活两处潜伏 Bug：① `matchExact` 只比对账号 ID 未比对主机列表/运行状态/名称/`sessionExpired`/`bound` 变化；② `updateAccountsInPlace` 只改胶囊类名与文本而未更新内联 `onclick` 中的翻转布尔值。
- **修改步骤**：
  1. `app.js:548` 修改为 `renderAccounts(isSilent);`。
  2. 在 `renderAccounts()` 中给每个 `.account-card` 写入结构指纹属性（例如 `data-struct-sig`，涵盖账号名、`enabled`、`sessionExpired`、`bound`、`platform`、各主机 `id/status/powerState/vendor` 列表），在 `matchExact` 时若任一卡片的 `data-struct-sig` 与最新数据不一致则返回 `false` 触发重建（或者单卡级局部替换）。
  3. 修改 `toggleVmFeature` 等胶囊点击处理：在按钮上不再硬编码下次目标布尔值（或由 `updateAccountsInPlace` 同步更新内联 `onclick`/读取 `btn.dataset.enabled` 并即时翻转），同时保留 `tests/regression.test.js:4792` 所校验的 `onclick="toggleVmFeature('${acc.id}', '${usid}', 'autoBootEnabled'...` 模式与 `tests/regression.test.js:4803-4812` 所校验的 `if (pAutoBoot) {` 与 `pAutoBoot.innerText = \`🛡️守护: `（可在 `toggleVmFeature` 内根据按钮当前状态取反，或在 `updateAccountsInPlace` 中同步刷新 `pKeep.setAttribute('onclick', ...)` / `pTask.setAttribute('onclick', ...)` / `pAutoBoot.setAttribute('onclick', ...)`）。

---

### [P1-18] 修复卡片拖拽排序失效
- **位置**：`app/static/app.js:2026, 2218-2266`
- **根因**：HTML5 拖放规范中 `drop` 先于 `dragend` 触发；`handleSlotDrop` 与 `handleCardDrop` 在 `draggedAccId` 仍未清零时调用 `renderAccounts()`，被第 2026 行守卫 `if (draggedAccId || activeEditingAccId) return;` 直接拦截。
- **修改步骤**：在 `handleSlotDrop()`（`:2233` 前）和 `handleCardDrop()`（`:2253` 前）调用 `renderAccounts()` **之前**，先行执行状态清零：`draggedAccId = null; draggedCardEl = null; draggedSlotIndex = null;` 并移除 `.dragging` / `.drag-over` / `.droppable` 样式类。

---

### [P1-19] 实现 `onProductSelectChange()` 修复自动兑换下拉框报错
- **位置**：`app/static/index.html:528` & `app/static/app.js`（`openRedeemModal` / `onManualProductChange` 附近）
- **根因**：`#redeem-product-select` 绑定了 `onchange="onProductSelectChange()"`，但全仓无此函数定义，切换商品时直接抛 `ReferenceError`。
- **修改步骤**：在 `app.js` 中补全 `function onProductSelectChange()`，读取 `#redeem-product-select` 当前选中项的 `dataset.type`（及需要绑定桌面的商品 ID 集合，与 `onManualProductChange` 一致），联动显示/隐藏 `#group-desktop-select`。

---

### [P1-20] 修复配置误覆写、弹窗状态与认证/SSE 竞态及 CSS Bug
- **位置**：`app/static/app.js` 多处 & `app/static/style.css`
- **修改步骤**：
  1. **修复纯 ZTE 账号编辑时强制开启 `autoBoot`**（`app.js:2834-2840`）：编辑现有 YDPC 账号时，若 `existingAcc.features?.autoBoot === undefined`，保持 `undefined`（或编辑态不覆盖 `autoBoot` 字段，交由后端 `PUT /api/accounts/:id` 原样合并），绝不强转为 `true`。
  2. **修复 `saveSettings()` 覆盖全局周期**（`app.js:4276-4277`）：移除硬编码的 `keepAliveSeconds: 60` 和 `pulseIntervalSeconds: 30`（或从 `openSettingsModal` 读取的当前设置值原样回传，避免每次修改标题/Cron 都把后端调好的周期冲回默认值）。
  3. **修复编辑弹窗标题被覆盖**（`app.js:2786, 2798`）：模仿天翼云分支（`2807`），为 `ydpc`（`2786`）和 `ecloud`（`2798`）分支设置标题增加 `if (modalTitle && isNew)` 条件。
  4. **修复扫码定时器与弹窗异步竞态**（`app.js:463-465, 2615-2674, 3566-3575, 3639, 3917-3931, 3982-3991`）：
     - `closeModal(id)` 当 `id === 'account-modal'` 时立即 `clearInterval(qrPollingTimer); qrPollingTimer = null;` 并重置 `pendingEcloudLogin = null;`；
     - `loadQrCodeForModal()` 引入单调递增请求序号 `qrRequestSeq`，`await` 返回后若序号已变化则直接弃置，避免重开弹窗漏挂多个轮询定时器；
     - `openRedeemModal` / `openPowerModal` 同样增加请求版本号校验当前正在编辑的账号 ID 未切换，避免快速切换账号时旧请求覆写下拉框；按账号维护短信倒计时定时器或在切换弹窗/账号时清理旧定时器。
  5. **修复启动登录态闪烁 & 失效 Token 清理 & SSE 错误态**（`app.js:232-234, 328-414, 4711-4720`）：
     - 启动时先 `await checkCurrentUser()` 再调用 `loadAccounts()`（或在 `checkCurrentUser()` 确认已登录后调用 `renderAccounts()`），消除短暂闪现访客登录卡片的问题；
     - 当 `/api/auth/me` 返回 `isLoggedIn: false` 时，清空 `currentAuthToken = ""`，清理 `localStorage` 与 `sessionStorage` 中的 `ctyun_auth_token`，关闭现有 `eventSource`，并调用 `renderAccounts()` 展示未登录态；
     - `eventSource.onerror`：若 `!currentUser` 则 `eventSource.close(); eventSource = null;`；若已登录则把流状态徽章置为 `badge-offline` / 警告文案「日志流重连中...」，禁止显示绿色的「心跳保持正常」。
  6. **补齐响应校验 & `??` 零值判断 & 安全截断**：
     - `syncAccountTasks`（`4170-4176`）、`restartKeeper`（`4206-4209`）、`loadAccounts`（`546-547`）、`loadStatus`（`470-471`）：均须校验 `res.ok`（且 `Array.isArray(data)` 才覆盖全局 `accounts`），失败时展示真实错误 Toast，绝不假报成功；
     - `5026`（`u.maxQuota ?? 2`）、`1671, 1816`（`m.cycleCountdown ?? 30`）改用空值合并运算符 `??`；
     - `1143, 1384, 1641, 5113, 5133`：抽取 `firstGrapheme(str)` / `sliceGraphemes(str, n)`（使用 `Intl.Segmenter` 优先，`Array.from` 兜底），修复 `👨‍💻` / `🛡️` 等多码元 Emoji 截断和空名称报错；
     - `3410`：修正逻辑永真分支，对失效重验且缺少验证码时明确提示阻断；
     - `248-258, 2305` 键盘 `Enter` 监听加 `if (e.isComposing) return;`；`2335` 改为 `if (activeEditingAccId === accId) activeEditingAccId = null;`；`4726` 清空占位元素带 `.log-placeholder` 类名并在 `upsertLogLine` 清除；`4823-4861` 文件导入处理开头重置 `input.value = ""`；给 `openModal`/`closeModal` 及日志初始化 DOM 查找补充空安全判断。
  7. **修复 CSS 布局与暗色主题 Bug**（`app/static/style.css`）：
     - `1578-1590`：将 `[data-theme="dark"] .account-card span[style*="background:#f1f5f9"]`（及带空格写法 `background: #f1f5f9`）从琥珀色分组移入正确的浅灰中性暗色分组；
     - `177-179`：`body.has-docked-log` 改为 `padding-bottom: calc(var(--docked-log-height, 280px) + 84px);`（并在 JS 拖拽高度时更新 `--docked-log-height` CSS 变量）；
     - `934-938`：列表视图网格定位规则补全 `.account-card > .vm-group-empty`；
     - `2574-2580`（及 `app.js:1236, 1481`）：移除 `ecloud`/`ydpc` `.card-action-tools` 上的内联 `style="grid-template-columns: ..."`，收口到 CSS 类中定义，让 `<= 480px` 媒体查询正常生效；
     - `145`：排除 `code, pre, kbd, .mono` 或把字体设定从 `*` 移到 `body, button, input, select, textarea`，恢复 `<code>` 等宽字体。

---

## Phase 6：P2 性能、架构与工程化优化

### [P2-01] 降频同步写盘与天翼云上游轮询
- **位置**：`app/ecloud/ecloud_client.js:740`、`server.js:1008-1053`、`server.js:3088-3186`
- **优化方案**：
  1. `ecloud_client.js:740`：不要每 20 秒 tick 无条件调用 `this.saveConfig()`；仅在 `acted === true`、`status` 变化或桌面属性变化时落盘。
  2. `server.js:1008-1053`：记录上一次落盘序列化摘要（或 `lastSavedHash`），若配置与上次落盘字节完全一致直接跳过写盘，降低容器挂载 NAS/SD 卡 I/O 磨损。
  3. `server.js:3088-3186`：天翼云 `runCycleLoop` 将 `getDesktops()` 与 `refreshOfficialTasks()` 拆出“每 10 秒必跑”的路径，分别增加时间戳节流（如桌面列表 60~120 秒一次、任务进度常态 180 秒一次，挂机模式/待核验期间保持 15 秒高频），降低上游风控风险。

---

### [P2-02] 前端轮询节流与日志终端性能提升
- **位置**：`app/static/app.js:193-196, 236-245, 388, 4558-4707` & `app/static/style.css:1863-1865`
- **优化方案**：
  1. **后台休眠节流**（`app.js:236-245`）：5 秒定时器与 `focus` 回调中若 `!currentUser || document.hidden` 则直接跳过；监听 `document.addEventListener('visibilitychange', ...)` 在切回前台且已登录时立即同步一次。
  2. **SSE 幂等重连**（`388, 4660`）：`initLogStream()` 记录当前连接关联的 `token`，若 `eventSource` 处于 `OPEN`/`CONNECTING` 且 `token` 未变化则直接复用，不再于保存设置/修改配额时断开重建并重放 80 条历史。
  3. **日志性能**（`4558-4707`）：
     - 维护 `logIndexById = new Map()` 取代每条日志 `O(N)` `allReceivedLogs.findIndex`；
     - 去掉 `void existing.offsetWidth` 同步回流，若需闪烁高亮请用 `requestAnimationFrame` 切换 `.log-flash` 并在 `style.css:1863-1865` 定义真实 keyframe 动画 + `animationend` 移除类；
     - `#log-search-input` 绑定 150ms 防抖；
     - `renderFilteredLogs()` 严格截取 `.slice(-MAX_RENDERED_LOG_LINES)` 并通过 `DocumentFragment` 一次性插入；将高频 `scrollTop` 更新合并入 `requestAnimationFrame`。

---

### [P2-03] 消除代码重复与清理死代码
- **位置与清理清单**：
  1. **抽取共享 TLS 受控降级工具 `app/ydpc/tls_policy.js`**（⚠️ 注意同步登记进 `tests/syntax_check.js` 及 `tests/regression.test.js` 组 7 扫描清单！）：统一 `CERT_CHAIN_ERROR_CODES`、`isCertChainError(err)`（完整遍历 `err.cause` 链，补齐 `scg_keepalive.js` 与 `zte_cag_tls.js` 原先漏查深层 `cause` 的缺陷），由 `cag_boot.js`、`zte_cag_tls.js`、`scg_keepalive.js`、`mqtt_client.js` 复用。
  2. **统一 `ydpc_client.js` 时长耗尽判断**：提取 `isDurationExhaustedError(errMsg)` 覆盖 `用完|已用尽|计费周期|到期|欠费`（补齐 `L1797` 原先漏掉的 `欠费`），替换 L530、L1336、L1797 重复逻辑。
  3. **清理死代码**：
     - `app/static/app.js`：清理无效 `#menu-admin-users` 引用、未调用的 `triggerTask`（`4182`）与 `copyToClipboard`（`4750`）、未消费的 `prodInstId` 传递、重复的 `formatYdpcRemainText`/`formatEcloudRemainText`（`775, 892`）及多处重复的状态角标计算函数；
     - `app/static/style.css`：清理未用的 `.btn-accent`、`.pill-on-autoboot`/`.pill-off-autoboot`；
     - `app/static/icons.js` 与 `index.html`：或者将 `index.html` 重复的内联 `<svg>` 统一精简，或删除 `icons.js` 中未用图标；
     - `app/ecloud_engine/*.py`：清理未使用的独立 CLI 入口残留、多余内联 `import base64`/`json`、未用变量（`device.py`, `config.py`, `login.py`, `sidecar.py:503`）、`config.py` 重复端点常量，以及校正 `keepalive.py:15` 过时 docstring；修复或删除从未调用且多 Catch `EcloudError` 的 `post_with_failover`。
     - `app/ecloud/ecloud_engine.js` & `ecloud_client.js`：清理未用的 `maxRestarts`/`_restarts`/`_lastEngineStderr`/局部 `accName` 与不可达语句 `if (!this.metrics.l1.lastAt)`（`695-702`）。

---

### [P2-04] 单体文件模块化拆分路线图（可选中长期架构重构）
> 建议在 Phase 1–5 全部完成且回归稳定后再执行此项，避免大范围移动代码掩盖 Bug 修复的 diff 审查。
1. **`server.js`（6,581 行）拆分方向**：
   - `app/config/config_store.js`：主密钥加载、AES-256-GCM 密码加解密、双备份容灾 `loadConfig`/`saveConfig`、`atomicWriteFileSync`。
   - `app/services/notify.js`：SSRF 校验与 8 大通知渠道实现。
   - `app/services/task_gate.js`：`TASK_FEATURE_KEY`、`resolveTaskEnabled`、`inferLogPlatform`。
   - `app/ctyun/ctyun_client.js`：`CtYunClient` 与 `CtYunEncryption` 整合。
   - `app/routes/*.js`：按 `auth`、`accounts`、`ydpc`、`ecloud`、`ctyun_proxy`、`admin`、`logs` 拆分子路由，**`server.js` 保持对外 `module.exports` 完全兼容**（如 `tests/regression.test.js` 对 `server.js` 源码做静态检查，拆文件前须同步更新对应静态断言指向新模块）。
2. **`app/static/app.js`（5,242 行）拆分方向**：
   - 使用 `<script defer src="/static/js/...">` 或原生 ES Modules，按 `state.js`、`api.js`、`utils.js`、`cards/{ctyun,ydpc,ecloud}.js`、`in_place_sync.js`、`logs.js`、`modals/*.js` 拆解，避免单文件难以维护，同时为所有关键操作按钮增加防双击禁用守卫 `withButtonLock(btn, asyncFn)` 与移动端无障碍改进（恢复缩放 `user-scalable`、补齐 `role="button"`/`aria-label`、把拖拽手柄限定在 `.card-top` 恢复正文复制）。

---

### [P2-05] 工程化、Docker/CI 与测试覆盖补全
- **位置**：`package.json`、`tests/syntax_check.js`、`tests/regression.test.js`、`Dockerfile`、`app/ecloud_engine/requirements.txt`、`.github/workflows/docker-build.yml`
- **修改步骤**：
  1. **`package.json:11-12`**：删除指向不存在文件 `analysis/smoke_check.js` 的 `"smoke"` 脚本并修正 `"verify"` 为 `"node tests/syntax_check.js && node tests/regression.test.js && node tests/mutation_check.js"`（或补齐真实冒烟脚本）。
  2. **`tests/syntax_check.js:15-30`**：把遗漏的 `app/auth_manager.js`、`app/ctyun_encryption.js`、`app/ydpc/soho_client.js`、`app/ydpc/cag_client.js`、`app/ydpc/mqtt_client.js` 全部纳入 `FILES`（及重要项入 `REQUIRED`）。
  3. **`Dockerfile` 与 `requirements.txt` & `.github/workflows/docker-build.yml`**：
     - `app/ecloud_engine/requirements.txt` 固定合理版本上限（如 `requests>=2.31,<3`、`pycryptodome>=3.20,<4`）；`Dockerfile` 改为 `COPY app/ecloud_engine/requirements.txt ./` 并 `pip3 install -r requirements.txt`；`builder` 阶段改为 `npm ci --omit=dev`；
     - 增加 Docker `HEALTHCHECK`（探活 `/` 或 `/api/auth/me`），评估切换非 `root` 用户（配合 entrypoint `chown` 挂载卷 `/app/data` 避免宿主机权限问题）；
     - `.github/workflows/docker-build.yml:26` 将 CI 测试 `node-version` 从 `'20'` 对齐到与 `Dockerfile` 一致的 `'22'`。
  4. **新增回归断言清单（建议随 Phase 1–5 同步补入 `tests/regression.test.js`）**：
     - `[P0-01]` 未登录/普通用户请求 `/api/keeper/restart` 与 `/api/ctyun-proxy` 必拒；
     - `[P0-02]` `isValidWebhookTarget` 对 `[::1]`、`[::ffff:127.0.0.1]`、`100.64.0.1` 必拒；
     - `[P0-03/04]` 账号接口响应不含明文 `password` / `savedLoginInfo`；用户表不再使用原始用户名拼装 `onclick`；
     - `[P1-02/03]` `checkExternalPowerOn` 不覆写用户主动关闭的 `keepAlive`；`refreshOfficialTasks` 在任务接口失败、积分成功时返回 `ok: false`；
     - `[P1-05]` `TaskScheduler` 在混有 `ydpc` / `ecloud` 账号时 `allAccountsFullyDone` 仍能对天翼云达成并标记完成，`subCron` 分支排除非天翼云账号；
     - `[P1-07/08/10/11]` 真实调用 `ydpcClient.verifyKeepAliveEffect(1, 1)` 不抛 `ReferenceError`；`refreshVms()` 已有 `vendor` 不再打 `getFirmAuth()`；SCG `waitMainInit` 断连立即退出不空转；`cag_boot` 不二次编码 `%2B`；
     - `[P1-13/15/16]` 多进程写同一 `sessions.json` / `login_rate_limit.json` 不互相抹除；`ecloudClient.refreshDesktops()` 保留 `autoBootEnabled: false`；`normalize_power_state("unavailable")` 返回 `'unknown'`/`'off'` 绝非 `'on'`；
     - `[P1-17/18/19]` `app.js` 确认 `renderAccounts(isSilent)` 传参、`onProductSelectChange` 存在、拖拽落点前清零 `draggedAccId`。
