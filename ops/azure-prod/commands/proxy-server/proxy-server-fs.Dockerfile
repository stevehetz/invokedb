FROM nginx
ENV DOLLAR $
COPY nginx-fs.conf /etc/nginx/nginx.conf.template
ENTRYPOINT /bin/bash -c "envsubst < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && exec nginx -g 'daemon off;'"