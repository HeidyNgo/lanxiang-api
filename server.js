import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

app.get('/api/test', (req, res) => {
  res.json({ message: 'Hello from the API! The server is running!' });
});

app.listen(PORT, () => {
  console.log(`[TEST SERVER] Server is alive and running on port ${PORT}`);
});
