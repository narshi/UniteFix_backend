import axios from "axios";

async function test() {
  const api = axios.create({ baseURL: "https://unitefix-backend.onrender.com" });
  
  // 1. Register a test user
  const email = `test-${Date.now()}@example.com`;
  const registerRes = await api.post("/api/auth/register", {
    email,
    password: "password123",
    username: "Test User",
    phone: "1234567890",
    role: "customer"
  });
  
  console.log("Register response:", registerRes.data);
  const token = registerRes.data.token;
  
  api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  
  // 2. Add saved address
  const savedAddresses = [{
    label: "Home",
    address: "123 Test St, Test City",
    lat: 12.34,
    long: 56.78
  }];
  
  const updateRes = await api.patch("/api/client/profile", { savedAddresses });
  console.log("Update response:", updateRes.data);
  
  // 3. Get profile
  const getRes = await api.get("/api/client/profile");
  console.log("Get profile response:", getRes.data);
}

test().catch(e => {
  console.error(e.response ? e.response.data : e.message);
});
