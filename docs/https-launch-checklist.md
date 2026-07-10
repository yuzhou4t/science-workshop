# Science Workshop HTTPS 上线检查清单

默认架构是“Vercel 前端/代理 + 腾讯云公网 IP 后端”，无需另外购买域名：

```text
浏览器 → https://<VERCEL_ORIGIN> → https://<PUBLIC_IP>/science-workshop-api/ → 127.0.0.1:18080 → FastAPI
```

这份清单默认使用 Let’s Encrypt 公网 IP 证书。IP 证书必须使用 `shortlived` 配置，有效期约 160 小时（约 6 天），所以自动续期是上线的必要条件，不是可选优化。

命令依据：[Let’s Encrypt 的 Certbot IP 证书公告](https://letsencrypt.org/2026/03/11/shorter-certs-certbot) 和 [Certbot 续期/hook 文档](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)。

## 1. 先保护现有 OpenClaw

- [ ] 保留现有 OpenClaw 的 Nginx `server` / `location` / upstream 配置；不覆盖 `/etc/nginx/nginx.conf`，不删除已有站点文件。
- [ ] 用 `sudo nginx -T` 记录当前完整配置，并备份将要修改的文件。
- [ ] 把 `nginx/science-workshop-api.conf.template` 当作“合并参考”：将 ACME location、TLS 证书路径和 `/science-workshop-api/` location 合并到现有配置，不直接替换 OpenClaw 整个配置。
- [ ] 检查 80/443 端口是否已有 `default_server`。公网 IP 的 TLS 请求可能没有 SNI，因此实际上线时只能有一个正确的 443 默认服务；若 OpenClaw 也使用同一 IP，保留它的根路由，仅新增 Science Workshop 路径。

## 2. 公网 IP（默认路线，无需域名）

- [ ] 腾讯云安全组和主机防火墙允许公网 TCP 80/443；`18080` 只绑定回环地址，不对公网开放。
- [ ] 安装 Certbot 5.4+ 并用 `certbot --version` 核对。低于 5.4 的版本不支持用 `webroot` 申请 IP 证书，不得继续。
- [ ] 创建 `/var/www/acme/.well-known/acme-challenge`，并把模板中的 ACME location 合并进现有 OpenClaw HTTP server。
- [ ] 放置一个临时文件，确认 `http://<PUBLIC_IP>/.well-known/acme-challenge/<FILE>` 从公网返回文件原文，不是 OpenClaw 页面、404 或跳转循环。

先申请不可信的 staging 证书，验证 webroot 和公网 80 端口：

```bash
sudo certbot certonly --staging \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/acme \
  --ip-address <PUBLIC_IP>
```

- [ ] staging 成功后删除 `--staging` 再执行一次，只申请一次生产证书，避免触发频率限制。
- [ ] 确认 `sudo certbot certificates` 中的 Certificate Name，并核对 `/etc/letsencrypt/live/<PUBLIC_IP>/fullchain.pem` 与 `privkey.pem`。Certbot 目前不会自动将 IP 证书安装进 Nginx。
- [ ] 用生产证书路径替换模板中的 `{{SCIENCE_WORKSHOP_TLS_CERT}}` / `{{SCIENCE_WORKSHOP_TLS_KEY}}`，把 `{{SCIENCE_WORKSHOP_PUBLIC_HOST}}` 替换为公网 IP。

将续期配置和 Nginx deploy hook 持久化；`--run-deploy-hooks` 会在 reconfigure 的 staging 测试成功后验证 hook：

```bash
sudo certbot reconfigure \
  --cert-name <PUBLIC_IP> \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/acme \
  --ip-address <PUBLIC_IP> \
  --deploy-hook "systemctl reload nginx" \
  --run-deploy-hooks
```

- [ ] 用 `systemctl list-timers` 确认 Certbot 自动续期定时器已启用；不能只依赖人工执行。
- [ ] 执行 `sudo certbot renew --dry-run`，确认 webroot 验证成功。dry-run 默认不运行 deploy hook；hook 已由上面的 `reconfigure --run-deploy-hooks` 单独验证。
- [ ] 执行 `sudo nginx -t` 后再 `sudo systemctl reload nginx`。

## 3. Nginx、FastAPI 与持久化

- [ ] 容器内 FastAPI `8000` 只发布为宿主机 `127.0.0.1:18080:8000`；Nginx 只转发到 `127.0.0.1:18080`。
- [ ] 挂载 `/opt/science-workshop/storage/workflow_jobs:/data/workflow_jobs`，并设置 `WORKFLOW_STORAGE_DIR=/data/workflow_jobs`。
- [ ] 挂载 `/opt/science-workshop/repo/data:/opt/science-workshop/repo/data`，并设置 `SCIENCE_WORKSHOP_RUNTIME_SOURCES_PATH=/opt/science-workshop/repo/data/community-sources.json`。
- [ ] 先检查 `curl -fsS http://127.0.0.1:18080/api/health`，再检查 `curl -fsS https://<PUBLIC_IP>/health` 和 `curl -fsS https://<PUBLIC_IP>/science-workshop-api/api/health`。
- [ ] 确认 `client_max_body_size 25m`、120 秒上游超时和安全响应头已生效。

## 4. Vercel 前端代理

- [ ] 在 Preview 环境先设置 `SCIENCE_WORKSHOP_BACKEND_ORIGIN=https://<PUBLIC_IP>`。
- [ ] 设置 `SCIENCE_WORKSHOP_BACKEND_PREFIX=/science-workshop-api`、独立管理员/普通账号、会话密钥和与 FastAPI 相同的 `SCIENCE_WORKSHOP_PROXY_SECRET`。
- [ ] 确认生产代理继续拒绝非回环 `http://` 后端；不能因为没有域名就把公网 IP 降级为 HTTP。
- [ ] Preview 中验证登录、来源提交、管理员信箱、论文上传/导出和权限隔离；通过后才同步到 Production。

## 5. 可选域名路线

以后如果获得已解析到腾讯云的后端域名，可继续使用同一 Nginx/FastAPI 结构：

- [ ] 把 `{{SCIENCE_WORKSHOP_PUBLIC_HOST}}` 替换为域名，申请域名证书，并将 Vercel origin 改为 `https://<BACKEND_DOMAIN>`。
- [ ] 域名证书不必使用 IP 专用的 `--ip-address` 参数；切换前先在 Preview 重新验收。
- [ ] 保留公网 IP 回滚方案，但不要让两个定义同时抢占同一 `default_server`。
