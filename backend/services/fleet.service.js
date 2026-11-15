
const services = [];

const statuses = ['healthy', 'warning', 'critical'];

function generateServices() {
  for (let i = 1; i <= 2000; i++) {
    const id = `svc-${String(i).padStart(4, '0')}`;

    services.push({
      id,
      name: `Service ${String(i).padStart(4, '0')}`,
      p95: Math.floor(Math.random() * 500) + 50,
      errRate: Number((Math.random() * 5).toFixed(2)),
      rps: Math.floor(Math.random() * 1000) + 100,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      updatedAt: Date.now()
    });
  }
}

generateServices();

function getServices() {
  return services;
}

function getServiceById(id) {
  return services.find(service => service.id === id);
}

module.exports = {
  getServices,
  getServiceById
};
