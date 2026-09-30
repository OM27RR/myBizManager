const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const config = require('./core/config');
const errorHandler = require('./middleware/error.middleware');
const { AppError } = require('./core/errors');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const approvalRoutes = require('./routes/approvals');
const actionRoutes = require('./routes/actions');
const agentRoutes = require('./routes/agent');
const inventoryRoutes = require('./routes/inventory');
const supplierRoutes = require('./routes/suppliers');
const notificationRoutes = require('./routes/notifications');

const app = express();

app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/actions', actionRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.all('*splat', (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
});

app.use(errorHandler);

module.exports = app;