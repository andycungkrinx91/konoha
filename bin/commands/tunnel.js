"use strict";

/**
 * bin/commands/tunnel.js — Cloudflare & Ngrok Public Ingress Tunneling.
 */

const { info, error, success, header } = require("../lib/format");


async function cmdTunnel(args) {
  const sub = args[0] || 'status';
  const subArgs = args.slice(1);
  const tunnelMgr = require('../../src/tunnel/manager');
  const tunnelCfg = require('../../src/tunnel/config');

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    info('Usage: konoha tunnel <command>');
    info('Commands:');
    info('  status                   Show active tunnel status and public URL');
    info('  start [options]          Start public ingress tunnel (default: cloudflare)');
    info('    --token <token>        Cloudflare Tunnel token (run via cloudflared tunnel run --token <token>)');
    info('    --provider <cf|ngrok>  Select provider (cloudflare or ngrok)');
    info('    --port <port>          Target local port (default: 1404)');
    info('    --domain <domain>      Named custom domain');
    info('    --pin <pin>            Optional security PIN');
    info('  stop                     Stop active ingress tunnel');
    info('  config [options]         Configure tunnel options');
    info('    --token <token>        Set default tunnel token');
    return;
  }

  if (sub === 'status') {
    const status = tunnelMgr.getTunnelStatus();
    header('Public Ingress Tunnel Status');
    info(`Status:     ${status.enabled ? 'Active [CONNECTED]' : 'Inactive [STOPPED]'}`);
    info(`Provider:   ${status.provider}`);
    info(`Public URL: ${status.public_url || '(none)'}`);
    info(`PID:        ${status.active_pid || 0}`);
    return;
  }

  if (sub === 'start') {
    let provider = 'cloudflare';
    let port = 1404;
    let customDomain = undefined;
    let pin = undefined;
    let token = undefined;

    for (let i = 0; i < subArgs.length; i++) {
      if ((subArgs[i] === '--provider' || subArgs[i] === '-p') && subArgs[i + 1]) {
        provider = subArgs[++i];
      } else if (subArgs[i] === '--port' && subArgs[i + 1]) {
        port = parseInt(subArgs[++i], 10) || 1404;
      } else if (subArgs[i] === '--domain' && subArgs[i + 1]) {
        customDomain = subArgs[++i];
      } else if (subArgs[i] === '--pin' && subArgs[i + 1]) {
        pin = subArgs[++i];
      } else if ((subArgs[i] === '--token' || subArgs[i] === '-t') && subArgs[i + 1]) {
        token = subArgs[++i];
      }
    }

    if (customDomain || pin || token) {
      tunnelCfg.saveTunnelConfig({
        custom_domain: customDomain,
        auth_pin: pin,
        token: token
      });
    }

    info(`Starting ${provider} tunnel...`);
    try {
      const res = await tunnelMgr.startTunnel({ provider, port, token, domain: customDomain });
      success('Tunnel established successfully!');
      if (res.public_url) {
        info(`Public URL: ${res.public_url}`);
      }
    } catch (err) {
      error(`Failed to start tunnel: ${err.message}`);
    }
    return;
  }

  if (sub === 'stop') {
    tunnelMgr.stopTunnel();
    success('Tunnel stopped.');
    return;
  }

  if (sub === 'config') {
    let provider = undefined;
    let customDomain = undefined;
    let pin = undefined;
    let token = undefined;

    for (let i = 0; i < subArgs.length; i++) {
      if (subArgs[i] === '--provider' && subArgs[i + 1]) provider = subArgs[++i];
      else if (subArgs[i] === '--domain' && subArgs[i + 1]) customDomain = subArgs[++i];
      else if (subArgs[i] === '--pin' && subArgs[i + 1]) pin = subArgs[++i];
      else if (subArgs[i] === '--token' && subArgs[i + 1]) token = subArgs[++i];
    }

    tunnelCfg.saveTunnelConfig({
      provider,
      custom_domain: customDomain,
      auth_pin: pin,
      token
    });
    success('Tunnel configuration updated.');
    return;
  }

  error(`Unknown tunnel command: ${sub}. Run "konoha tunnel help" for usage.`);
}



module.exports = {
  cmdTunnel,
};
