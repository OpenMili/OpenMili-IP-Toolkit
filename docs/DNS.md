# DNS 检测

```text
openmili-ip dns --dns-host example.org
openmili-ip dns --resolver 1.1.1.1 --dns-protocols udp,tcp,doh
openmili-ip dns --resolver 1.1.1.1 --dns-protocols dot --dot-servername cloudflare-dns.com
openmili-ip dns --proxy socks5h://127.0.0.1:1080 --dns-protocols doh
```

读取系统 DNS/搜索域/接口指标；系统 getaddrinfo 与配置解析器查询分开。对系统首选 DNS 和两个公共解析器查询 A、AAAA、CNAME、MX、TXT。UDP 核对事务 ID、问题名/类型与连接对端；TCP/DoT 使用 DNS 长度帧并处理分片、大小上限。DoT 要求可信证书；DoH 使用 HTTPS JSON API 并校验响应问题。

每项记录解析器、协议、耗时、RCODE、TTL、响应和错误。NXDOMAIN/SERVFAIL 是解析器响应，不能简单当作网络断开。相同网站解析到不同 CDN 地址不证明污染。PTR 与正向回查分别保留实际结果。

代理模式不悄悄发起本机 UDP/TCP/DoT 和系统 DNS，而是明确跳过并可选 DoH。系统 getaddrinfo 无来源绑定保证时跳过；wire 查询严格绑定来源且验证协议族。环境代理按 HTTP_PROXY/HTTPS_PROXY/NO_PROXY 生效，显式 `--proxy` 覆盖；`--ignore-env-proxy` 和旧版显式 `--mode direct` 表示直连。

AD 只记录所查询解析器的声明，不冒充本地 DNSSEC 密码学验证。DNS64/NAT64 专用核验尚未实现，输出未确定。DNS 泄漏需要受控域名和递归日志，本版本明确跳过该可选项目。
