export default async function handler(req, res) {

  const API_KEY = process.env.USDA_KEY;
  const { query } = req.query;

  const response = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?query=${query}&api_key=${API_KEY}`
  );

  const data = await response.json();

  if (data.foods && data.foods.length > 0) {
    const calories = data.foods[0].foodNutrients.find(n => n.nutrientName === "Energy");
    res.status(200).json({ calories: calories?.value });
  } else {
    res.status(200).json({ calories: null });
  }
}