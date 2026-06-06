from flask import Flask, render_template, request, g, jsonify
import mysql.connector

app = Flask(__name__)

@app.before_request
def connect():
    conn = mysql.connector.connect(
        host="185.114.247.43", 
        database="sch688_magistratura", 
        user="sch688_magistratura", 
        password="Qwerty123")
    g.conn = conn
    
@app.teardown_request
def close_connect(er):
    g.conn.close()
    
@app.route("/")
def index():
    return render_template('registration.html')

@app.route("/login")
def registration():
    return render_template('avtorization.html')

@app.route("/user_registration", methods=['POST'])
def user_registration():
    data = request.json
    cursor = g.conn.cursor()
    cursor.execute("INSERT INTO users (name, surname, login, password) VALUES (%s, %s, %s, %s)", 
                   (data['name'], data['surname'], data['login'], data['password']))
    g.conn.commit()
    new_user_id = cursor.lastrowid
    cursor.close()
    return jsonify({'user_id': new_user_id, 'code': 200})

@app.route("/user_avtorization", methods=['POST'])
def user_registration():
    data = request.json
    cursor = g.conn.cursor()
    cursor.execute("SELECT * from users WHERE login=%s",(data['login'],))
    user = cursor.fetch()
    cursor.close()
    return jsonify({'user': user, 'code': 200})

@app.route("/chat")
def chat():
    name = request.args.get('nickname')
    return f'{name}, привет!'

app.run()
