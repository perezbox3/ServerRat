import 'dotenv/config'
import { createApp } from './app.js'

const PORT = process.env.PORT || 3003

const app = createApp({})
app.listen(PORT, () => console.log(`ServerRat listening on ${PORT}`))
