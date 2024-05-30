import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/user.model.js';
import { uploadOnCloudinary } from '../utils/cloudinary.js';
import { ApiResponse } from '../utils/ApiResponse.js';

// export const registerUser = asyncHandler(async (req, res) => {
//   //   res.status(200).json({
//   //     message: 'ok',
//   //   });

//   const { fullName, email, username, password } = req.body;
//   console.log('email: ', email);

//   if (
//     [fullName, email, username, password].some((field) => field?.trim() === '')
//   ) {
//     throw new ApiError(400, 'All fields are required');
//   }

//   const existedUser = await User.findOne({
//     $or: [{ username }, { email }],
//   });

//   if (existedUser) {
//     throw new ApiError(409, 'User with email or username already exists');
//   }

//   const avatarLocalPath = req.files?.avatar[0]?.path;
//   const coverImageLocalPath = req.files?.coverImage[0]?.path;

//   if (!avatarLocalPath) {
//     throw new ApiError(400, 'Avatar file is required');
//   }

//   const avatar = await uploadOnCloudinary(avatarLocalPath);
//   const coverImage = await uploadOnCloudinary(coverImageLocalPath);

//   if (!avatar) {
//     throw new ApiError(400, 'Avatar file is required');
//   }

//   const user = await User.create({
//     fullName,
//     avatar: avatar.url,
//     coverImage: coverImage?.url || '',
//     email,
//     password,
//     username: username.toLowerCase(),
//   });

//   const createdUser = await User.findById(user._id).select(
//     '-password -refreshToken'
//   );

//   if (!createdUser) {
//     throw new ApiError(500, 'Something went wrong while creating user');
//   }

//   return res
//     .status(201)
//     .json(new ApiResponse(200, createdUser, 'User registered successfully'));
// });

const generateAccessAndRefereshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      'Something went wrong while generating referesh and access token'
    );
  }
};

export const registerUser = asyncHandler(async (req, res) => {
  // Destructuring request body to extract user details
  const { fullName, email, username, password } = req.body;

  // Checking if any required fields are missing or empty
  if ([fullName, email, username, password].some((field) => !field?.trim())) {
    throw new ApiError(400, 'All fields are required');
  }

  // Checking if a user with the same email or username already exists
  const existedUser = await User.findOne({ $or: [{ username }, { email }] });
  if (existedUser) {
    throw new ApiError(409, 'User with email or username already exists');
  }

  // Handling avatar and cover image file uploads
  const avatarLocalPath = req.files?.avatar[0]?.path;
  const coverImageLocalPath = req.files?.coverImage[0]?.path;

  // Ensuring that avatar file is provided
  if (!avatarLocalPath) {
    throw new ApiError(400, 'Avatar file is required');
  }

  // Uploading avatar and cover image to Cloudinary
  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = coverImageLocalPath
    ? await uploadOnCloudinary(coverImageLocalPath)
    : null; // Handling case where cover image is not provided

  // Checking if avatar upload was successful
  if (!avatar) {
    throw new ApiError(500, 'Avatar upload failed');
  }

  // Creating the new user in the database
  const newUser = await User.create({
    fullName,
    email,
    username: username.toLowerCase(), // Converting username to lowercase
    password, // Note: Ensure password is hashed before storing it in production
    avatar: avatar.url,
    coverImage: coverImage?.url || '', // Cover image URL or empty string if not provided
  });

  // Retrieving the newly created user from the database
  const createdUser = await User.findById(newUser._id).select(
    '-password -refreshToken'
  );

  // Handling case where user creation failed
  if (!createdUser) {
    throw new ApiError(500, 'Failed to create user');
  }

  // Returning successful response with the newly created user
  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, 'User registered successfully'));
});

export const loginUser = asyncHandler(async (req, res) => {
  const { email, username, password } = req.body;

  if (!username && !email) {
    throw new ApiError(400, 'Username or email is required');
  }

  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (!user) {
    throw new ApiError(404, 'User does not exist');
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, 'Invalid user credentials');
  }

  const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(
    user._id
  );

  const loggedInUser = await User.findById(user._id).select(
    '-password -refreshToken'
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie('accessToken', accessToken, options)
    .cookie('refreshtoken', refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        'User logged in successfully'
      )
    );
});

export const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: { refreshToken: undefined },
    },
    {
      new: true,
    }
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .clearCookie('accessToken', options)
    .clearCookie('refreshToken', options)
    .json(new ApiResponse(200, {}, 'User Logged Out Successfully'));
});

export const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, 'unauthorized request');
  }

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    const user = await User.findById(decodedToken?._id);

    if (!user) {
      throw new ApiError(401, 'Invalid refresh token');
    }

    if (incomingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, 'Refresh token is expired or used');
    }

    const options = {
      httpOnly: true,
      secure: true,
    };

    const { accessToken, newRefreshToken } =
      await generateAccessAndRefereshTokens(user._id);

    return res
      .status(200)
      .cookie('accessToken', accessToken, options)
      .cookie('refreshToken', newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          'Access token refreshed'
        )
      );
  } catch (error) {
    throw new ApiError(401, error?.message || 'Invalid refresh token');
  }
});
