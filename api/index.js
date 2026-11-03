// api/index.js - Vercel Serverless Function entry point
const { app } = require('../server/server');
const db = require('../server/db');

let initialized = false;

module.exports = async (req, res) => {
  if (!initialized) {
    try {
      await db.initDb();
      initialized = true;
    } catch (err) {
      console.error('Vercel DB initialization error:', err);
    }
  }
  return app(req, res);
};
