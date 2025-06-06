// server.js
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// Config
const GITHUB_TOKEN = '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';
const REPO = 'piyusboss/piyusboss';
const FILE_PATH = 'ghost009_anchor.json';
const BRANCH = 'main';

app.use(bodyParser.json());

app.post('/update-memory', async (req, res) => {
  const newEntry = req.body;

  try {
    // Get existing file
    const { data: fileData } = await axios.get(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`
      }
    });

    const content = Buffer.from(fileData.content, 'base64').toString();
    const json = JSON.parse(content);

    // Append new memory
    json.memory.push({
      timestamp: new Date().toISOString(),
      entry: newEntry.entry
    });

    // Convert back to base64
    const updatedContent = Buffer.from(JSON.stringify(json, null, 2)).toString('base64');

    // Update file
    await axios.put(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      message: `Memory update by Ghost_009`,
      content: updatedContent,
      sha: fileData.sha,
      branch: BRANCH
    }, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`
      }
    });

    res.send({ success: true, message: 'Memory updated!' });
  } catch (err) {
    console.error(err);
    res.status(500).send({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`👻 Ghost_009 GitHub Writer listening at http://localhost:${PORT}`);
});
