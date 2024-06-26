import express from 'express';
import dotenv from 'dotenv';
import { identify } from './contactController';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post('/identify', identify);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
