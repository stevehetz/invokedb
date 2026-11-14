FROM nginx
ENV DOLLAR $
COPY nginx.conf /etc/nginx/nginx.conf.template
COPY generated/horizon-fe /usr/share/nginx/html/horizon-fe
COPY generated/horizon-auth-fe /usr/share/nginx/html/horizon-auth-fe
COPY generated/horizon-demo /usr/share/nginx/html/horizon-demo
ENTRYPOINT /bin/bash -c "envsubst < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && exec nginx -g 'daemon off;'"