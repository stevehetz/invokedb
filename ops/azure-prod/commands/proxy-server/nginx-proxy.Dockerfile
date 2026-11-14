FROM jwilder/c
RUN { \
    echo 'client_max_body_size 1000M;'; \
    echo 'proxy_send_timeout  2000s;'; \
    echo 'proxy_read_timeout  2000s;'; \
    } > /etc/nginx/conf.d/my_proxy.conf