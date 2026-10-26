# 网站规则与证据

`websites --mode http` 使用 curl 原始与桌面头请求；`--mode browser` 另启 Chromium。默认目录 `domains.yaml` 当前 38 项、九类，版本 websites-v1。报告保存规则版本、更新时间、失效日和原始 YAML SHA-256。

每站可配置 `category`、`weight`、`expected_text`、`allowed_hosts`、`timeout`、`rule_version`、`updated_at`、`expires_at`。预期标记是可见文字或标题的任一不区分大小写子串。规则应使用具体词组，不能用单个 X 证明 X 首页。旧清单可运行，但不具备新增规则的同等保证。

判断依次检查传输错误、规则有效性、最终域名/HTTPS、挑战/地区/人机验证、429、认证、403、未完成跳转、HTTP 错误、空页面/JS 要求、登录入口、预期页面标记。过期、非预期站点或标记不符降为 UNKNOWN；HTTP 200 不等于可用，403/429 不等于断网。邮件只测公开登录入口，视频只测主页。

DNS/TCP/TLS/连接拒绝/超时分别记录可读传输错误。HTTP 与浏览器均采用站点超时；实际出口起止核验失败时保留证据、不归入该 IP 评分。浏览器、账号、时段及目标分流仍可影响结果，不作注册、播放或绝对纯净保证。

维护者可运行 `node scripts/migrate-site-rules.cjs` 重建该版规则；在线验证使用 `node scripts/verify-websites.cjs`，配置的 Git 代理只在显式 `--git-proxy` 下用于本次实测。
