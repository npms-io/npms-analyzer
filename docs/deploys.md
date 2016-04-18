# Deploys

We use `pm2` to deploy `npms-analyzer`, install it by running `$ npm install -g pm2`. You may find the pm2 configuration file in `ecosystem.json5`.

## Setting up

Before doing the first deploy, you need to setup the server:

- Ensure that the `analyzer` user exists in the server
- Install pm2 in the server
- Setup the deploy environment by running `$ pm2 deploy ecosystem.json5 production setup` in your local machine
- Create `~/npms-analyzer/local.json5` in the server with the custom configuration (databases, GitHub API tokens, etc)
- Do your first deploy by running `$ pm2 deploy ecosystem production` in your local machine
- If everything is ok, setup pm2 to run at start by running `$ pm2 startup -u analyzer --hp "/home/analyzer"` as root on the server. Then switch to the `analyzer` user and run `$ pm2 save` to store the running processes.

## Deploying

Deployment is easy, just run `$ pm2 deploy ecosystem production` in your local machine
