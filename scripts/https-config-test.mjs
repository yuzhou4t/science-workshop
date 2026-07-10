import assert from "node:assert/strict";
import fs from "node:fs";

const template = fs.readFileSync("nginx/science-workshop-api.conf.template", "utf8");
const checklist = fs.readFileSync("docs/https-launch-checklist.md", "utf8");
const backendEnv = fs.readFileSync("backend/.env.example", "utf8");
const runbook = fs.readFileSync("docs/runbook.md", "utf8");

assert.match(template, /listen 443 ssl http2/);
assert.match(template, /server_name \{\{SCIENCE_WORKSHOP_PUBLIC_HOST\}\}/);
assert.doesNotMatch(template, /SCIENCE_WORKSHOP_API_DOMAIN/);
assert.match(template, /location \^~ \/\.well-known\/acme-challenge\//);
assert.match(template, /root \/var\/www\/acme/);
assert.match(template, /merge/i);
assert.match(template, /OpenClaw/i);
assert.match(template, /proxy_pass http:\/\/127\.0\.0\.1:18080\//);
assert.match(template, /proxy_pass http:\/\/127\.0\.0\.1:18080\/api\/health/);
assert.doesNotMatch(template, /proxy_pass http:\/\/127\.0\.0\.1:8000/);
assert.match(template, /location \/science-workshop-api\//);
assert.match(template, /client_max_body_size 25m/);
assert.match(template, /proxy_read_timeout 120s/);
assert.match(template, /Strict-Transport-Security/);
assert.match(template, /return 301 https:\/\/\$host\$request_uri/);
assert.doesNotMatch(template, /106\.53\.153\.215/);
assert.match(checklist, /公网 IP（默认路线，无需域名）/);
assert.match(checklist, /Certbot\s+5\.4\+/);
assert.match(checklist, /--preferred-profile shortlived/);
assert.match(checklist, /--webroot-path \/var\/www\/acme/);
assert.match(checklist, /--ip-address <PUBLIC_IP>/);
assert.match(checklist, /certbot certonly --staging/);
assert.match(checklist, /certbot reconfigure/);
assert.match(checklist, /--deploy-hook "systemctl reload nginx"/);
assert.match(checklist, /certbot renew --dry-run/);
assert.match(checklist, /SCIENCE_WORKSHOP_BACKEND_ORIGIN=https:\/\/<PUBLIC_IP>/);
assert.match(checklist, /保留.*OpenClaw.*Nginx/);
assert.match(checklist, /可选域名路线/);
assert.match(checklist, /nginx -t/);
assert.match(checklist, /127\.0\.0\.1:18080:8000/);
assert.match(checklist, /\/opt\/science-workshop\/storage\/workflow_jobs:\/data\/workflow_jobs/);
assert.match(checklist, /\/opt\/science-workshop\/repo\/data:\/opt\/science-workshop\/repo\/data/);
assert.match(backendEnv, /^WORKFLOW_STORAGE_DIR=\/data\/workflow_jobs$/m);
assert.match(
  backendEnv,
  /^SCIENCE_WORKSHOP_RUNTIME_SOURCES_PATH=\/opt\/science-workshop\/repo\/data\/community-sources\.json$/m,
);
assert.match(runbook, /WORKFLOW_STORAGE_DIR=\/data\/workflow_jobs/);
assert.match(
  runbook,
  /SCIENCE_WORKSHOP_RUNTIME_SOURCES_PATH=\/opt\/science-workshop\/repo\/data\/community-sources\.json/,
);
assert.match(runbook, /127\.0\.0\.1:18080:8000/);
assert.match(runbook, /Certbot\s+5\.4\+/);
assert.match(runbook, /--preferred-profile shortlived/);
assert.match(runbook, /--ip-address <PUBLIC_IP>/);
assert.match(runbook, /--deploy-hook "systemctl reload nginx"/);
assert.match(runbook, /SCIENCE_WORKSHOP_BACKEND_ORIGIN=https:\/\/<PUBLIC_IP>/);
assert.match(runbook, /保留.*OpenClaw.*Nginx/);
console.log("HTTPS config template ok");
