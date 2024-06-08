const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const ACCOUNT_ID = process.env.ACCOUNT_ID || '';
const API_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@hf/meta-llama/meta-llama-3-8b-instruct`;
const API_TOKEN = process.env.API_TOKEN || '';

const mongoURI = process.env.MONGO_URI || '';

mongoose.connect(mongoURI, { replicaSet: process.env.REPLICA_NAME })
  .then(() => console.log('MongoDB connected successfully.'))
  .catch(err => console.error('Error connecting to MongoDB:', err));

const conversationSchema = new mongoose.Schema({
  username: { type: String, required: true },
  messages: [{
    role: { type: String, required: true },
    content: { type: String, required: true }
  }]
});

const Conversation = mongoose.model('Conversation', conversationSchema);

let customPrompt = '';

function loadPrompt() {
  try {
    customPrompt = fs.readFileSync('prompt.txt', 'utf8');
    console.log("Prompt has been read from prompt.txt");
  } catch (error) {
    console.error("Error reading prompt from file:", error);
    customPrompt = "Default system prompt";
  }
}

loadPrompt();

async function getBotResponse(username, message) {
  try {
    const userMessage = { role: "user", content: message };

    let conversation = await Conversation.findOne({ username });
    if (!conversation) {
      conversation = new Conversation({ username, messages: [] });
    }

    const messages = conversation.messages.concat(userMessage);
    conversation.messages = messages;

    const data = {
      messages: [{ role: "system", content: customPrompt }, ...messages],
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_TOKEN}`
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const responseData = await response.json();
    if (!responseData.result || !responseData.result.response) {
      throw new Error('Unexpected API response format');
    }

    const botMessage = responseData.result.response;
    conversation.messages.push({ role: "assistant", content: botMessage });

    await conversation.save();

    return botMessage;
  } catch (error) {
    console.error("Error fetching response:", error);
    return "Sorry, I couldn't process your request at the moment.";
  }
}

app.get('/user', async (req, res) => {
  const { username, text } = req.query;
  if (!username || !text) {
    return res.status(400).json({
      creator: "Guru",
      status: false,
      text: text,
      result: "Bad Request: Please provide both username and text parameters."
    });
  }

  const botMessage = await getBotResponse(username, text);
  res.status(200).json({
    creator: "Guru",
    status: true,
    text: text,
    result: botMessage
  });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
