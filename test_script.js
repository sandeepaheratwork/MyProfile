const http = require('http');

const runTest = async () => {
    // 1. Link Preview Test
    console.log("--- Test 1: Link Previews ---");
    const previewRes = await fetch("http://localhost:3001/api/link-preview?url=https://github.com/v8/v8");
    const previewData = await previewRes.json();
    console.log("Status:", previewRes.status);
    console.log("Data:", previewData);

    // 2. Mentions & Hashtags Test (Login first)
    console.log("\n--- Test 2 & 3: Hashtags and Mentions Extraction ---");
    
    // Attempt Admin login (assuming setup has been run or we can use the regular register)
    const registerRes = await fetch('http://localhost:3001/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'TestUser', email: 'test@auto.com', password: 'password123' })
    });
    
    // Login to get Token
    const loginRes = await fetch('http://localhost:3001/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@auto.com', password: 'password123' })
    });
    
    const loginData = await loginRes.json();
    if(!loginData.success) {
        console.log("Login failed");
        return;
    }
    const token = loginData.token;

    // Create a Post with Mentions and Hashtags
    const postRes = await fetch('http://localhost:3001/api/blogs', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-auth-token': token
        },
        body: JSON.stringify({
            title: "Automated Test Post",
            content: "Hey @Sandeep and @Admin! I am testing the new #ReactJS and #Node ecosystem. It is super fast.",
            tags: ["Testing"]
        })
    });

    const postData = await postRes.json();
    console.log("Blog creation status:", postRes.status);
    console.log("Extracted Tags:", postData.blog.tags);
    console.log("Extracted Mentions:", postData.blog.mentions);

    process.exit(0);
};

runTest();
