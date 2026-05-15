CREATE DATABASE IF NOT EXISTS leaveease;
USE leaveease;

-- USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  dob DATE NOT NULL
);
-- LEAVE TYPES TABLE
CREATE TABLE leave_types (
    leave_type_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT
);

-- ADMINS TABLE
CREATE TABLE admins (
    admin_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    designation VARCHAR(100),
    contact_email VARCHAR(100),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- LEAVE APPLICATIONS TABLE
CREATE TABLE leave_applications (
    leave_application_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    leave_type_id INT NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(leave_type_id)
);

-- LOGS TABLE
CREATE TABLE logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    action VARCHAR(100) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Log new leave applications
DELIMITER $$

CREATE TRIGGER log_new_leave_application
AFTER INSERT ON leave_applications
FOR EACH ROW
BEGIN
  INSERT INTO logs (user_id, action, description)
  VALUES (
    NEW.user_id,
    'Leave applied',
    CONCAT('Leave ID: ', NEW.leave_application_id, ', Type: ', NEW.leave_type_id, ', From: ', NEW.from_date, ', To: ', NEW.to_date)
  );
END$$

DELIMITER ;

-- Log leave status changes
DELIMITER $$

CREATE TRIGGER log_leave_status_update
AFTER UPDATE ON leave_applications
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO logs (user_id, action, description)
    VALUES (
      NEW.user_id,
      CONCAT('Leave status changed to ', NEW.status),
      CONCAT('Leave ID: ', NEW.leave_application_id, ', From: ', NEW.from_date, ', To: ', NEW.to_date)
    );
  END IF;
END$$

DELIMITER ;


