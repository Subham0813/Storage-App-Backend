import fs from 'fs';
import path from 'path';

const docsDir = path.join(process.cwd(), 'docs');
const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));

const postman = {
  info: {
    name: 'StorageApp API Collection',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  item: []
};

for (const file of files) {
  const content = fs.readFileSync(path.join(docsDir, file), 'utf-8');
  const lines = content.split('\n');
  
  const folder = {
    name: file.replace('RouteRequestResponse.md', ''),
    item: []
  };

  let currentRequest = null;
  let inReqBody = false;
  let reqBodyStr = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Match endpoint header like "## 1. GET `/api/directories/all-dirs/:id`"
    const routeMatch = line.match(/^##\s+\d+\.\s+([A-Z]+)\s+`([^`]+)`/);
    if (routeMatch) {
      if (currentRequest && inReqBody) {
         if(reqBodyStr.trim()) currentRequest.request.body = { mode: "raw", raw: reqBodyStr, options: { raw: { language: "json" } } };
      }

      currentRequest = {
        name: routeMatch[2],
        request: {
          method: routeMatch[1],
          header: [],
          url: {
            raw: '{{base_url}}' + routeMatch[2].replace(/:([^\/]+)/g, '{{$1}}'),
            host: ['{{base_url}}'],
            path: routeMatch[2].split('/').filter(p => p).map(p => p.startsWith(':') ? '{{' + p.substring(1) + '}}' : p)
          }
        },
        response: []
      };
      folder.item.push(currentRequest);
      inReqBody = false;
      reqBodyStr = '';
    }
    
    if (currentRequest && line.trim() === '### Request') {
      // Look ahead for body
      for(let j = i+1; j < Math.min(i+30, lines.length); j++) {
        if(lines[j].startsWith('```json')) {
           inReqBody = true;
           i = j;
           break;
        } else if (lines[j].startsWith('### Success Response')) {
           break;
        }
      }
    } else if (currentRequest && inReqBody) {
       if(line.startsWith('```')) {
         if(reqBodyStr.trim()) currentRequest.request.body = { mode: "raw", raw: reqBodyStr, options: { raw: { language: "json" } } };
         inReqBody = false;
         reqBodyStr = '';
       } else {
         reqBodyStr += line + '\n';
       }
    }
  }

  if (currentRequest && inReqBody) {
     if(reqBodyStr.trim()) currentRequest.request.body = { mode: "raw", raw: reqBodyStr, options: { raw: { language: "json" } } };
  }

  postman.item.push(folder);
}

// Add variables
postman.variable = [
  {
    key: "base_url",
    value: "http://localhost:5000",
    type: "string"
  }
];

fs.writeFileSync('postman_collection.json', JSON.stringify(postman, null, 2));
console.log('Generated postman_collection.json');
