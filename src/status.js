const net = require("net");

function probePort(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function endpointKey(host, port) {
  return `${host}:${Number(port)}`;
}

function protocolLabel(desktop) {
  return String(desktop?.protocol || "rdp").toLowerCase() === "ssh" ? "SSH" : "RDP";
}

async function statusForDesktop(desktop, activeCount) {
  const kind = protocolLabel(desktop);
  const online = await probePort(desktop.host, desktop.port);
  if (!online) {
    return {
      state: "unavailable",
      label: "Unavailable",
      reason: `Host is offline or ${kind} is not accepting connections`,
    };
  }
  if (activeCount > 0) {
    return {
      state: "in-use",
      label: "In use",
      reason: "An active session is open through this gateway",
    };
  }
  return {
    state: "available",
    label: "Available",
    reason: `${kind} port is reachable`,
  };
}

module.exports = { probeRdp: probePort, probePort, endpointKey, statusForDesktop };
