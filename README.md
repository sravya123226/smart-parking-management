# Smart Parking System (SEMP Lab Mini Project)

## Run in VS Code
1. Install Node.js 18+ from https://nodejs.org
2. Open this folder in VS Code (File > Open Folder)
3. Open the terminal (Ctrl + `) and run:
       npm install
       npm start
4. Open http://localhost:3000

Admin login: admin@parking.com / admin123
Users: click Register on the login page.

## Mapping to your UML diagrams
- Class diagram: user, vehicle, parking slot, parking, admin, payment -> data collections in data/db.json + routes in server.js
- Use case diagram: login/logout, register, register vehicle, check slot availability, park, exit, make payment, add/move/update slot, manage parking -> screens in public/app.js
- Activity diagram: login -> register vehicle -> check availability -> slot free? (no: show slot is full) -> assign slot -> park -> exit -> pay -> update slot
- Component diagram: User Interface + Admin interface (public/), Vehicle/Parking/Parking slot/User/Payment/Admin components (server.js sections), Database (data/db.json)
- Deployment diagram: client-app (browser) -> HTTPS -> application server (parking-app + payment-service) -> JDBC -> database server.
  This project uses HTTP on port 3000 and a JSON file, so it runs with no database setup.
  To match the diagram exactly, replace the JSON file with MySQL (port 3306) using the mysql2 package.

Delete the data/ folder to reset all data.
