const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const ACCOUNT_ID = process.env.ACCOUNT_ID || '';
const API_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@hf/meta-llama/meta-llama-3-8b-instruct`;
const API_TOKEN = process.env.API_TOKEN || '';

const mongoURI = process.env.MONGO_URI || '';

mongoose.connect(mongoURI)
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

// Load custom prompt from file
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

// Fetch bot response and save conversation
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

// Fetch response from Bing and save conversation
async function bing(username, query) {
  try {
    const userMessage = { role: "user", content: query };

    let conversation = await Conversation.findOne({ username });
    if (!conversation) {
      conversation = new Conversation({ username, messages: [] });
    }

    const messages = conversation.messages.concat(userMessage);
    conversation.messages = messages;

    const response = await axios.post('https://nexra.aryahcr.cc/api/chat/complements', {
      messages: [{ role: "assistant", content: "Hello! How can I help you today? 😊" }, ...messages],
      conversation_style: "Balanced",
      markdown: false,
      stream: false,
      model: "Bing"
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    let result = null;
    let err = null;

    if (typeof response.data === "object") {
      if (response.data.code === 200 && response.data.status === true) {
        result = response.data;
      } else {
        err = response.data;
      }
    } else {
      try {
        const parsedData = JSON.parse(response.data.slice(response.data.indexOf("{")));
        if (parsedData.code === 200 && parsedData.status === true) {
          result = parsedData;
        } else {
          err = parsedData;
        }
      } catch (e) {
        err = {
          code: 500,
          status: false,
          error: "INTERNAL_SERVER_ERROR",
          message: "general (unknown) error"
        };
      }
    }

    if (err) {
      console.error(err);
    } else {
      console.log(result);
      const botMessage = result.message;
      conversation.messages.push({ role: "assistant", content: botMessage });
      await conversation.save();
      return botMessage;
    }
  } catch (error) {
    console.error('Error:', error);
    return "Sorry, I couldn't process your request at the moment.";
  }
}

// Fetch response from GPT-4 and save conversation
async function chatWithGPT(username, prompt) {
  try {
    const userMessage = { role: "user", content: prompt };

    let conversation = await Conversation.findOne({ username });
    if (!conversation) {
      conversation = new Conversation({ username, messages: [] });
    }

    const messages = conversation.messages.concat(userMessage);
    conversation.messages = messages;

    const data = {
      messages: [{ role: "assistant", content: "Hello! How are you today?" }, ...messages],
      prompt: prompt,
      model: "GPT-4",
      markdown: false
    };

    const config = {
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const response = await axios.post('https://nexra.aryahcr.cc/api/chat/gpt', data, config);

    if (response.status === 200) {
      const botMessage = response.data.gpt;
      conversation.messages.push({ role: "assistant", content: botMessage });
      await conversation.save();
      return botMessage;
    } else {
      console.error("Error:", response.statusText);
      return "Sorry, I couldn't process your request at the moment.";
    }
  } catch (error) {
    console.error('Error:', error);
    return "Sorry, I couldn't process your request at the moment.";
  }
}

// Endpoint to handle user requests
app.get('/user', async (req, res) => {
  const { username, query } = req.query;
  if (!username || !query) {
    return res.status(400).json({
      creator: "Guru",
      status: false,
      text: text,
      result: "Bad Request: Please provide both username and query parameters."
    });
  }

  const botMessage = await getBotResponse(username, query);
  res.status(200).json({
    creator: "Guru",
    status: true,
    text: query,
    result: botMessage
  });
});

// Endpoint to handle Bing requests
app.get('/bing', async (req, res) => {
  const { username, query } = req.query;
  if (!username || !query) {
    return res.status(400).json({
      status: false,
      message: "Bad Request: Please provide both username and query parameters."
    });
  }

  const botMessage = await bing(username, query);
  res.status(200).json({
    status: true,
    result: botMessage
  });
});

// Endpoint to handle GPT-4 requests
app.get('/chat-gpt', async (req, res) => {
  const { username, query } = req.query;
  if (!username || !query) {
    return res.status(400).json({
      status: false,
      message: "Bad Request: Please provide both username and prompt parameters."
    });
  }

  const botMessage = await chatWithGPT(username, query);
  res.status(200).json({
    status: true,
    result: botMessage
  });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
