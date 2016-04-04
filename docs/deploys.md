# Deploys

We use `pm2` to deploy `npms-analyzer`, install it by running `$ npm install -g pm2`.  
You may find the pm2 configuration file in `ecosystem.json5`.


## Setting up

Before actually doing the first deploy, you need to setup the server:

- Install pm2 in the server
- Setup the deploy environment by running `$ pm2 deploy ecosystem.json5 production setup` in your local machine
- Create `~/npms-analyzer/local.json5` in the server with the custom configuration (databases, GitHub api tokens, etc)


## Deploying

Deploy is very easy, just run `pm2 deploy ecosystem production`
