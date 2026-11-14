FROM node:10
RUN mkdir /horizon
RUN mkdir /horizon/packages
WORKDIR /horizon
COPY package.json /horizon
COPY ops /horizon/ops
COPY packages/horizon-be /horizon/packages/horizon-be
RUN cd packages/horizon-be && npm install
RUN apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 9DA31620334BD75D9DCB49F368818C72E52529D4
RUN echo "deb http://repo.mongodb.org/apt/debian stretch/mongodb-org/4.0 main" | tee /etc/apt/sources.list.d/mongodb-org-4.0.list
RUN apt-get update
RUN apt-get install -y mongodb-org
RUN apt-get install -y postgresql-client
RUN apt-get install -y vim