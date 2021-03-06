// Restaurant Review App

// Imports
var express = require('express'); // used to make an Express app
var app = express(); // make the app
var session = require('express-session'); // used for user login
var pgp = require('pg-promise')({
  // initialization options
}); // used for accessing the database
var db = pgp({database: 'restaurant'}); // also used for accessing the database
var body_parser = require('body-parser'); // used to retrieve input from HTML forms
var pbkdf2 = require('pbkdf2'); // used to encrypt password
var crypto = require('crypto'); // used to encrypt password

// Application setup
app.set('view engine', 'hbs'); // use handlebars for template rendering
app.use(express.static('public')); // Setup express to serve the files in the public folder
app.use(body_parser.urlencoded({extended: false}));

// saves a session
app.use(session({
  secret: process.env.SECRET_KEY || 'dev',
  resave: true,
  saveUninitialized: false,
  cookie: {maxAge: 60000}
}));

// Check to see if user needs to be logged in
app.use(function (req, resp, next) {
  if (req.session.user) {  // user is already logged in
    next();
  } else if (req.path == '/addreview' || req.path == '/restaurant/new') { // require login
      req.session.destination = req.originalUrl; // save intended destination
      resp.redirect('/login');
  } else {
      next(); // login not required
  }
});

// get method for root URL:/
app.get('/', function (req, resp, next) {
  var context = {
    title: 'Restaurant Review',
    login_name: req.session.login_name
  };
  resp.render('index.hbs', context);
});

// get method for login
app.get('/login', function (req, resp, next) {
  var context = {title: 'Login',
    uname: '',
    errmsg: ''
  };
  resp.render('login.hbs', context);
});

// post method for login
app.post('/login', function (req, resp, next) {
  var username = req.body.username; // get user name from the form
  var password = req.body.password; // get password from the form
  var q = 'SELECT * from reviewer WHERE email = $1';
  db.one(q, username) // sanitize SQL statement
    .then(function (result) {
      // validate password
      var db_pwd = result.pword;
      var pwd_parts = db_pwd.split('$');
      var key = pbkdf2.pbkdf2Sync(
        password,
        pwd_parts[2],
        parseInt(pwd_parts[1]),
        256,
        'sha256'
      );
      var hash = key.toString('hex');
      if (hash === pwd_parts[3]) {
        req.session.user = username; // set up a user session
        req.session.login_name = result.reviewer_name;
        req.session.reviewer_id = result.id;
        resp.redirect(req.session.destination);
      } else {
        var context = {title: 'Login',
          uname: username,
          errmsg: 'Incorrect password.'
        };
        resp.render('login.hbs', context);
      }
    })
    .catch(function (error) {
      var context = {title: 'Login',
        uname: username,
        errmsg: 'Incorrect login.'
      };
      resp.render('login.hbs', context);
    });
});

// get method for account creation form
app.get('/create_acct', function (req, resp, next) {
  var context = {title: 'Create Account',
    name: '',
    email: '',
    errmsg: ''
  };
  resp.render('createacct.hbs', context);
});

// post method for account creation form
app.post('/create_acct', function (req, resp, next) {
  // Get input from form
  var form_name = req.body.name;
  var form_email = req.body.email;
  var form_password = req.body.password;
  var form_confirmpwd = req.body.confirmpwd;
  if (form_password != form_confirmpwd) {
    var context = {title: 'Create Account',
      name: form_name,
      email: form_email,
      errmsg: 'Passwords do not match.'};
    resp.render('createacct.hbs', context);
  } else {
    var salt = crypto.randomBytes(20).toString('hex');
    var pwd = form_password;
    var key = pbkdf2.pbkdf2Sync(pwd, salt, 36000, 256, 'sha256');
    var hash = key.toString('hex');
    var encrypted_pwd = `pbkdf2_sha256$36000$${salt}$${hash}`;
    var reviewer_info = {
      name: form_name,
      email: form_email,
      password: encrypted_pwd
    };
    var q = 'INSERT INTO reviewer \
      VALUES (default, ${name}, ${email}, NULL, ${password}) RETURNING id';
    db.one(q, reviewer_info)
      .then(function (result) {
        req.session.user = form_email; // set up a user session
        req.session.login_name = form_name;
        req.session.reviewer_id = result.id;
        // redirect to home page
        resp.redirect('/');
      })
      .catch(next);
  }
});

// Display list of restaurants that match search criteria
app.get('/search', function (req, resp, next) {
  // Get query parameters from URL
  var search_criteria = req.query.searchcriteria;
  var q = "SELECT * from restaurant WHERE name ILIKE '%$1#%'";
  db.any(q, search_criteria) // sanitize SQL statement
    .then(function (result) {
      var context = {
        title: 'Restaurant List',
        result: result,
        login_name: req.session.login_name
      };
      resp.render('list.hbs', context);
    })
    .catch(next);
});

// get method for adding a restaurant
app.get('/restaurant/new', function (req, resp, next) {
  var context = {
    title: 'Add Restaurant',
    login_name: req.session.login_name
  };
  resp.render('addrestaurant.hbs', context);
});

// post method for adding a restaurant
app.post('/restaurant/submit_new', function (req, resp, next) {
  // Get input from form
  var form_restaurant_name = req.body.restaurant_name;
  var form_address = req.body.restaurant_addr;
  var form_category = req.body.restaurant_cat;
  var restaurant_info = {
    name: form_restaurant_name,
    address: form_address,
    category: form_category
  };
  var q = 'INSERT INTO restaurant \
    VALUES (default, ${name}, ${address}, ${category}) RETURNING id';
    db.one(q, restaurant_info)
      .then(function (result) {
        // redirect to display restaurant details
        resp.redirect('/restaurant/' + result.id);
      })
      .catch(next);
});

// Display details for a restaurant
app.get('/restaurant/:id', function (req, resp, next) {
  var id = req.params.id;
  var q = 'SELECT restaurant.id as id, restaurant.name, restaurant.address, restaurant.category, review.stars, review.title, review.review, reviewer.reviewer_name, reviewer.email, reviewer.karma FROM restaurant \
  LEFT JOIN review ON restaurant.id = review.restaurant_id \
  LEFT JOIN reviewer on reviewer.id = review.reviewer_id \
  WHERE restaurant.id = $1';
  db.any(q, id)
    .then(function (results) {
      resp.render('restaurant.hbs', {
        title: 'Restaurant',
        results: results,
        login_name: req.session.login_name});
    })
    .catch(next);
});

// get method for adding a review
app.get('/addreview', function (req, resp, next) {
  var id = req.query.id;
  var context = {
    title: 'Add Restaurant Review',
    id: id,
    login_name: req.session.login_name};
  resp.render('addreview.hbs', context);
});

// post method for adding a review
app.post('/addreview', function (req, resp, next) {
  // Get input from form
  var form_restaurant_id = req.body.id;
  var form_title = req.body.review_title;
  var form_review = req.body.review_text;
  var form_stars = parseInt(req.body.review_stars);
  var review_info = {
    stars: form_stars,
    title: form_title,
    review: form_review,
    reviewer_id: req.session.reviewer_id,
    restaurant_id: form_restaurant_id
  };
  var q = 'INSERT INTO review \
    VALUES (default, ${stars}, ${title}, ${review}, ${reviewer_id}, ${restaurant_id}) RETURNING id';
    db.one(q, review_info)
      .then(function (result) {
        resp.redirect('/restaurant/' + form_restaurant_id);
      })
      .catch(next);
});

// get method for signout
app.post('/signout', function (req, resp, next) {
  req.session.destroy(function (err) {
  });
  resp.redirect('/');
});

// Listen for requests
app.listen(8000, function() {
  console.log('* Listening on port 8000 *')
});
