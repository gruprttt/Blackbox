# Shared proxy settings for the API (see nginx.conf).
proxy_pass http://api:8000;
proxy_http_version 1.1;
proxy_set_header Connection "";
# $http_host keeps the port, so the API's same-origin check matches the browser's Origin header.
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
# Behind another HTTPS proxy/load balancer? Pass its scheme instead so cookies get the Secure flag:
#   proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 5s;
proxy_read_timeout 20s;
add_header Cache-Control "no-store" always;
add_header X-Content-Type-Options "nosniff" always;
