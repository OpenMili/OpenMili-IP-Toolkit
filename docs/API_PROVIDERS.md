# 公开数据源、许可与缓存

默认查询 RIPEstat Network Info、Team Cymru IP-to-ASN，以及 IANA RDAP Bootstrap 选出的官方 RIR HTTPS RDAP。向这些来源提交查询 IP；Cymru 使用编码后的反向 TXT 名称，代理模式通过 DoH 发送。ASN/注册国不代表实际使用地或住宅使用者。

`data/providers.json` 保存规则版本、条款链接、缓存 TTL 和来源组。每个适配器执行 fetch / validate / normalize / cache / evidence；核验前缀/地址范围和目标 IP，MOAS 保留全部起源 ASN。RDAP 从 IANA 官方清单选择最长匹配前缀，不使用 rdap.org 代替官方来源。

增强来源默认关闭：

| 开启方式 | 来源 | 边界 |
|---|---|---|
| `--community-sources` 或 `IPAPI_API_KEY` | ipapi.is | 用户应先核对免费/商用授权与配额；只使用实际返回字段 |
| `IPINFO_TOKEN` | IPinfo | 使用已授权套餐；没有 company/privacy 字段即未知 |
| `ABUSEIPDB_API_KEY` | AbuseIPDB APIv2 | 查询近 90 天；保留原始来源分数、举报数及最后事件时间；不是“官方风险概率” |

不默认使用需要额外授权的 DNSBL、MaxMind、IP2Location 等服务，也不通过网页批量抓取代替授权 API。来源缺失不会阻断其他模块。

缓存默认 `$USERPROFILE/.openmili-ip/cache` 或 `$HOME/.openmili-ip/cache`；`--cache-dir` 可指定。BGP 1h、登记/IANA 24h、属性 1h、信誉 15min。缓存键区分版本、目标、传输路径和凭据范围（散列，不存凭据）。`--refresh` 强制刷新；`--offline` 只读缓存并显著标记 stale，过期类型/风险不进入当前结论。

超时/5xx 使用有界指数退避，`--retries 0..3`；429 尊重 Retry-After，等待过长时跳过并进入来源冷却期，避免持续重试。缓存不可写时继续返回已取得的实际结果。API 结构变化或 IP 不符返回 UNKNOWN。

`checked_at` 是本次获取时间；`source_updated_at` 仅在来源提供真实更新时间时存在。不能把抓取时间冒充数据库更新时间。离线历史只保留实际已有缓存，不能“补算”过去网站访问。

可复现：`node scripts/verify-live-p1.cjs`；如果显式需要复用本机 Git 的代理，加 `--git-proxy`。输出只含公开测试地址及标准化状态，代理凭据不输出。
