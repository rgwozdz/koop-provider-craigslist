'use strict';
// Cache configured time or 1 hour
const config = require('config');
const ttl = (config.craigslist && config.craigslist.ttl) || 60 * 60;
const request = require('request').defaults({ gzip: true });
const types = require('./mappings/types.js');
const idField = 'featureId';

module.exports = function() {
  // Adding "idField" as instance property gives koop-core ability to determine presence of idField during provider 
  // registration. 
  this.idField = idField

  // This is our one public function it's job its to fetch data from craigslist and return as a feature collection
  this.getData = (req, callback) => {
    const city = req.params.host;
    const type = req.params.id;
    request(`https://${city}.craigslist.org/jsonsearch/${types[type]}/?map=1`, (err, res, body) => {
      if (err) return callback(err);
      const apartments = translate(res.body);
      apartments.ttl = ttl;
      apartments.metadata = {
        name: `${city} ${type}`,
        description: `Craigslist ${type} listings proxied by https://github.com/dmfenton/koop-provider-craigslist`,
        hasStaticData: false,
        idField: this.idField
      };
      callback(null, apartments);
    });
  };

  
};

// Map accross all elements from a Craigslist respsonse and translate it into a feature collection
function translate(data) {
  const list = JSON.parse(data);
  const featureCollection = {
    type: 'FeatureCollection',
    features: []
  };
  if (list && list[0]) {
    // Only return apartments with an "Ask" property;  this filters out geo-clusters
    const apartments = list[0].filter(node => {
      return node.Ask;
    });

    featureCollection.features = createFeaturesWithArcGISCompliantIDs(apartments, formatFeature)
  }
  return featureCollection;
}

// This function takes a single element from the craigslist response and translates it to GeoJSON
// TODO format based on schema types for other craiglists things like jobs
function formatFeature(apt, id) {
  const feature = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [apt.Longitude, apt.Latitude]
    },
    properties: {
      title: apt.PostingTitle,
      price: parseFloat(apt.Ask),
      bedrooms: parseFloat(apt.Bedrooms),
      postDate: dateFormat(apt.PostedDate),
      posting: apt.PostingURL,
      thumbnail: apt.ImageThumb
    }
  };

  feature.properties[idField] = id

  if (!isNaN(feature.properties.price) && !isNaN(feature.properties.bedrooms)) {
    const ppbr = feature.properties.price / feature.properties.bedrooms;
    if (ppbr !== 0 && ppbr !== Infinity) feature.properties.pricePerBedroom = ppbr;
  }
  return feature;
}

function dateFormat(date) {
  return new Date(parseInt(date, 10) * 1000).toISOString();
}

// This next two functions could be wrapped in their own NPM that providers could require and use
/**
 * Format features and add an ArcGIS compliant OBJECTID to the idField
 * @param {*} list list of feature to receive formatting
 * @param {*} formatFunction the function that formats list items
 */
function createFeaturesWithArcGISCompliantIDs(list, formatFunction) {
  const MAX_OBJECTID = 2147483647

  // If number of features is greater than ArcGIS Object ID limit, trim the list to that limit 
  if (list.length > MAX_OBJECTID + 1) {
    // List is so large that there are not enough digits available for a random numeric prefix, so
    // format list items and use iterator alone for the idField
    return list.slice(0, MAX_OBJECTID + 1).map((item, i) => formatFunction(item, i))
  } else {
    // Get a random integer prefix for constructing an OBJECTID
    let numericPrefix = getRandomIntPrefix(list.length)
    // Format list items and use the concatenation of the prefix and iterator as the idField value
    return list.map((item, i) => formatFunction(item, Number(`${numericPrefix}${i}`)))
  }
}

/**
 * Create a integer prefix (as string). Prefix will be such that final concatenated value <= 2147483647
 * @param {*} maxIteratorValue the max value of iterator to which the prefix will be concatenated
 */
function getRandomIntPrefix (maxIteratorValue) {
  // Get the number of digits in feature count
  const digits = maxIteratorValue.toString().length

  // Set value for max OBJECTID (from ArcGIS, signed 32-bit integer)
  const MAXID = (2147483647).toString()

  // Calculate the largest allowable prefix for this set of features by
  // stripping place values need for the ID concatenation; then minus 1
  // to ensure the final concatenation is less then the MAXID
  const maxPrefix = Number(MAXID.substring(0, MAXID.length - digits)) - 1

  // Select a random number from 0 to maxPrefix and return as string
  return Math.floor(Math.random() * maxPrefix).toString()
}